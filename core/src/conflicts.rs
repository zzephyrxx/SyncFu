use crate::{
    engine::{Engine, Work},
    files,
    model::*,
    policy::TaskPolicy,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
};

#[cfg(test)]
mod tests;

pub const PREVIEW_LIMIT: u64 = 256 * 1024;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct ConflictDescriptor {
    pub path: String,
    pub versions: BTreeMap<String, Option<Entry>>,
    pub fingerprint: String,
    pub resolvable: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct ConflictResolution {
    pub conflict: ConflictDescriptor,
    pub source_device: String,
}
impl ConflictResolution {
    pub fn change(&self, policy: &TaskPolicy, local: &str) -> Result<Change> {
        ensure!(
            self.conflict.resolvable && self.conflict.versions.len() == 2,
            "结构冲突需先人工处理"
        );
        let source = self
            .conflict
            .versions
            .get(&self.source_device)
            .context("冲突来源无效")?;
        let destination = policy
            .endpoints
            .iter()
            .find(|e| e.device != self.source_device)
            .context("冲突目标无效")?;
        ensure!(
            policy.contains(&self.source_device) && policy.permits_target(&destination.device),
            "选择违反同步方向"
        );
        let before = self
            .conflict
            .versions
            .get(&destination.device)
            .context("缺少目标状态")?
            .clone();
        ensure!(
            !self
                .conflict
                .versions
                .values()
                .flatten()
                .any(|e| matches!(e, Entry::Directory)),
            "目录冲突不能强制覆盖"
        );
        let after = source.clone();
        let action = if after.is_none() {
            Action::Delete
        } else if before.is_none() {
            Action::Create
        } else {
            Action::Update
        };
        let change = Change {
            path: self.conflict.path.clone(),
            action,
            target: usize::from(destination.device != local),
            before,
            after,
        };
        policy.validate_change(&change, local, false)?;
        ensure!(
            self.conflict.fingerprint
                == conflict_fingerprint(policy, &self.conflict.path, &self.conflict.versions)?,
            "冲突内容摘要无效"
        );
        Ok(change)
    }
}
pub fn conflict_fingerprint(
    policy: &TaskPolicy,
    path: &str,
    versions: &BTreeMap<String, Option<Entry>>,
) -> Result<String> {
    digest(&(policy.fingerprint()?, path, versions))
}
pub fn describe(
    policy: &TaskPolicy,
    local: &str,
    comparison: &Comparison,
) -> Result<Vec<ConflictDescriptor>> {
    let remote = policy
        .endpoints
        .iter()
        .find(|e| e.device != local)
        .context("缺少对端")?;
    let structural: BTreeSet<_> = comparison
        .changes
        .iter()
        .filter(|c| {
            c.action == Action::Conflict
                && [c.before.as_ref(), c.after.as_ref()].contains(&Some(&Entry::Directory))
        })
        .map(|c| c.path.as_str())
        .collect();
    comparison
        .changes
        .iter()
        .filter(|c| c.action == Action::Conflict)
        .map(|c| {
            let versions = BTreeMap::from([
                (local.to_owned(), c.before.clone()),
                (remote.device.clone(), c.after.clone()),
            ]);
            Ok(ConflictDescriptor {
                path: c.path.clone(),
                fingerprint: conflict_fingerprint(policy, &c.path, &versions)?,
                resolvable: !structural.contains(c.path.as_str())
                    && !c
                        .path
                        .match_indices('/')
                        .any(|(i, _)| structural.contains(&c.path[..i])),
                versions,
            })
        })
        .collect()
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(tag = "choice", rename_all = "snake_case", deny_unknown_fields)]
pub enum Decision {
    Use { source_device: String },
    Later,
    IgnoreVersion,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct DecisionRequest {
    pub path: String,
    pub decision: Decision,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct ReviewNote {
    pub task: String,
    pub path: String,
    pub fingerprint: String,
    pub ignored: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct FilePreview {
    pub device: String,
    pub entry: Option<Entry>,
    pub text: Option<String>,
    pub reason: Option<String>,
}
pub fn validate_preview(
    preview: &FilePreview,
    device: &str,
    expected: &Option<Entry>,
) -> Result<()> {
    ensure!(
        preview.device == device && &preview.entry == expected,
        "对端预览身份或内容指纹不符"
    );
    if let Some(text) = &preview.text {
        ensure!(
            text.len() as u64 <= PREVIEW_LIMIT
                && preview.reason.is_none()
                && Some(files::hash_file(text.as_bytes())?) == *expected,
            "对端预览内容未通过指纹校验"
        );
    } else {
        let valid = match (expected, preview.reason.as_deref()) {
            (None, Some("missing")) | (Some(Entry::Directory), Some("directory")) => true,
            (Some(Entry::File { bytes, .. }), Some("too_large")) => *bytes > PREVIEW_LIMIT,
            (Some(Entry::File { bytes, .. }), Some("binary")) => *bytes <= PREVIEW_LIMIT,
            _ => false,
        };
        ensure!(valid, "对端预览状态无效");
    }
    Ok(())
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct ConflictPreview {
    pub path: String,
    pub versions: Vec<FilePreview>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PreviewRequest {
    pub task: String,
    pub path: String,
    pub policy_digest: String,
    pub expected: Option<Entry>,
}

impl Engine {
    pub(crate) fn read_preview(&self, request: &PreviewRequest, peer: &str) -> Result<FilePreview> {
        files::validate_path(&request.path)?;
        let task = self.task(&request.task)?;
        ensure!(task.peer == peer, "预览未获任务授权");
        let state = self.policy_state(&task.id)?;
        let policy = state.ready()?;
        ensure!(
            policy.fingerprint()? == request.policy_digest && !policy.is_excluded(&request.path),
            "预览策略已变化或路径被排除"
        );
        let root = self.root(&task.local, peer)?;
        let mut result = FilePreview {
            device: self.local_device()?,
            entry: request.expected.clone(),
            text: None,
            reason: None,
        };
        match &request.expected {
            Some(Entry::File { bytes, .. }) if *bytes <= PREVIEW_LIMIT => {
                let file = root.read(&request.path)?;
                let mut data = Vec::with_capacity(*bytes as usize);
                file.take(PREVIEW_LIMIT + 1).read_to_end(&mut data)?;
                ensure!(
                    data.len() as u64 <= PREVIEW_LIMIT
                        && files::hash_file(data.as_slice())?
                            == request.expected.clone().context("缺少预期状态")?,
                    "预览期间文件已变化"
                );
                result.text = String::from_utf8(data)
                    .ok()
                    .filter(|text| !text.contains('\0'));
                if result.text.is_none() {
                    result.reason = Some("binary".into());
                }
            }
            Some(Entry::File { .. }) => {
                ensure!(
                    root.state(&request.path)? == request.expected,
                    "预览文件已变化"
                );
                result.reason = Some("too_large".into());
            }
            Some(Entry::Directory) => {
                ensure!(root.state(&request.path)? == request.expected, "目录已变化");
                result.reason = Some("directory".into());
            }
            None => {
                ensure!(root.state(&request.path)?.is_none(), "文件已重新出现");
                result.reason = Some("missing".into());
            }
        }
        Ok(result)
    }
    pub fn review_notes(&self, task: &str) -> Result<Vec<ReviewNote>> {
        self.task(task)?;
        Ok(self
            .store
            .list::<ReviewNote>("review_notes")?
            .into_iter()
            .filter(|n| n.task == task)
            .collect())
    }
    pub fn clear_review_note(&self, task: &str, path: &str) -> Result<()> {
        self.task(task)?;
        files::validate_path(path)?;
        self.store.delete("review_notes", &digest(&(task, path))?)
    }
    pub(crate) fn save_review_notes(
        &self,
        task: &str,
        replaced: &[String],
        notes: &[ReviewNote],
    ) -> Result<()> {
        let mut db = self.store.conn();
        let tx = db.transaction()?;
        for path in replaced {
            tx.execute(
                "DELETE FROM records WHERE bucket='review_notes' AND key=?1",
                [digest(&(task, path))?],
            )?;
        }
        for note in notes {
            ensure!(note.task == task, "审阅记录不属于此任务");
            crate::store::put(
                &tx,
                "review_notes",
                &digest(&(&note.task, &note.path))?,
                note,
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub(crate) fn validate_resolutions(
        &self,
        work: &Work,
        policy: &TaskPolicy,
        local: &str,
    ) -> Result<BTreeMap<String, Change>> {
        let auth = work.authorization.as_ref().context("缺少工作授权")?;
        if !auth.resolutions.is_empty() {
            ensure!(
                work.batch.undo_of.is_none() && policy.can_manage(&work.owner),
                "此端无权批准冲突覆盖"
            );
        }
        let planned = auth
            .planned
            .iter()
            .map(|c| (c.path.as_str(), c))
            .collect::<BTreeMap<_, _>>();
        let mut output = BTreeMap::new();
        for resolution in &auth.resolutions {
            let change = resolution.change(policy, local)?;
            ensure!(
                planned.get(change.path.as_str()).copied() == Some(&change)
                    && output.insert(change.path.clone(), change).is_none(),
                "冲突决策不属于计划或重复"
            );
        }
        Ok(output)
    }
}
