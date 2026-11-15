use crate::{files, model::*};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const SCHEMA_VERSION: u32 = 3;
pub fn valid_device(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct Endpoint {
    pub device: String,
    pub grant: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum Direction {
    Bidirectional,
    OneWayUpdate { source_device: String },
    OneWayMirror { source_device: String },
}
impl Direction {
    pub fn source(&self) -> Option<&str> {
        match self {
            Self::Bidirectional => None,
            Self::OneWayUpdate { source_device } | Self::OneWayMirror { source_device } => {
                Some(source_device)
            }
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    Manual,
    OnChange,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Trust {
    Unclassified,
    Personal,
    Shared { owner_device: String },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ConflictRule {
    Hold,
    PreferDevice { device: String },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct DeleteRules {
    pub max_files: u32,
    pub relative_min: u32,
    pub percent: u32,
    pub window_seconds: u32,
}
impl Default for DeleteRules {
    fn default() -> Self {
        Self {
            max_files: 100,
            relative_min: 10,
            percent: 20,
            window_seconds: 600,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct TaskPolicy {
    pub task: String,
    pub revision: u32,
    pub endpoints: [Endpoint; 2],
    pub direction: Direction,
    pub trigger: Trigger,
    pub trust: Trust,
    pub conflicts: ConflictRule,
    pub excludes: Vec<String>,
    pub deletion: DeleteRules,
}
impl TaskPolicy {
    pub fn legacy(task: &Task, local: &str) -> Result<Self> {
        let mut endpoints = [
            Endpoint {
                device: local.into(),
                grant: task.local.clone(),
            },
            Endpoint {
                device: task.peer.clone(),
                grant: task.remote.clone(),
            },
        ];
        endpoints.sort_by(|a, b| a.device.cmp(&b.device));
        let policy = Self {
            task: task.id.clone(),
            revision: 0,
            endpoints,
            direction: Direction::Bidirectional,
            trigger: Trigger::Manual,
            trust: Trust::Unclassified,
            conflicts: ConflictRule::Hold,
            excludes: vec![],
            deletion: DeleteRules::default(),
        };
        policy.validate()?;
        Ok(policy)
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            valid_device(&self.task) && self.endpoints[0].device < self.endpoints[1].device,
            "策略任务或端点顺序无效"
        );
        for endpoint in &self.endpoints {
            ensure!(
                valid_device(&endpoint.device)
                    && uuid::Uuid::parse_str(&endpoint.grant)
                        .is_ok_and(|id| id.to_string() == endpoint.grant),
                "策略端点无效"
            );
        }
        let mut grants = self
            .endpoints
            .iter()
            .map(|e| e.grant.clone())
            .collect::<Vec<_>>();
        grants.sort();
        ensure!(
            grants[0] != grants[1] && digest(&grants)? == self.task,
            "策略目录关系无效"
        );
        if let Some(source) = self.direction.source() {
            ensure!(self.contains(source), "策略来源不是任务端点");
        }
        if let Trust::Shared { owner_device } = &self.trust {
            ensure!(self.contains(owner_device), "策略所有者无效");
        }
        if let ConflictRule::PreferDevice { device } = &self.conflicts {
            ensure!(self.contains(device), "冲突优先端无效");
            ensure!(
                self.direction
                    .source()
                    .is_none_or(|source| source == device),
                "单向任务不能优先接收端反写"
            );
        }
        ensure!(self.excludes.len() <= 256, "排除规则过多");
        let mut aliases = BTreeSet::new();
        for path in &self.excludes {
            files::validate_path(path)?;
            ensure!(aliases.insert(files::portable_key(path)), "排除规则重复");
        }
        let d = &self.deletion;
        ensure!(
            (1..=10_000).contains(&d.max_files)
                && (1..=d.max_files).contains(&d.relative_min)
                && (1..=100).contains(&d.percent)
                && (60..=86_400).contains(&d.window_seconds),
            "删除保护配置无效"
        );
        if self.trust == Trust::Unclassified {
            ensure!(
                self.revision == 0
                    && self.direction == Direction::Bidirectional
                    && self.trigger == Trigger::Manual
                    && self.conflicts == ConflictRule::Hold
                    && self.excludes.is_empty()
                    && self.deletion == DeleteRules::default(),
                "未分类任务只能手动双向运行"
            );
        }
        Ok(())
    }
    pub fn contains(&self, device: &str) -> bool {
        self.endpoints.iter().any(|e| e.device == device)
    }
    pub fn can_manage(&self, actor: &str) -> bool {
        self.contains(actor)
            && match &self.trust {
                Trust::Personal => true,
                Trust::Shared { owner_device } => owner_device == actor,
                Trust::Unclassified => false,
            }
    }
    pub fn permits_target(&self, target: &str) -> bool {
        self.contains(target) && self.direction.source() != Some(target)
    }
    pub fn fingerprint(&self) -> Result<String> {
        digest(self)
    }
    pub fn target_device<'a>(&'a self, local: &'a str, target: usize) -> Result<&'a str> {
        ensure!(self.contains(local) && target <= 1, "操作目标无效");
        Ok(if target == 0 {
            local
        } else {
            self.endpoints
                .iter()
                .find(|e| e.device != local)
                .ok_or_else(|| anyhow::anyhow!("缺少对端"))?
                .device
                .as_str()
        })
    }
    pub fn is_excluded(&self, path: &str) -> bool {
        let key = files::portable_key(path);
        self.excludes.iter().any(|rule| {
            let rule = files::portable_key(rule);
            key == rule
                || key
                    .strip_prefix(&rule)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
    }
    fn protects_directory(&self, path: &str) -> bool {
        let prefix = format!("{}/", files::portable_key(path));
        self.excludes
            .iter()
            .any(|rule| files::portable_key(rule).starts_with(&prefix))
    }
    pub fn filter(&self, manifest: &Manifest) -> Manifest {
        let entries: Entries = manifest
            .entries
            .iter()
            .filter(|(p, _)| !self.is_excluded(p))
            .map(|(p, e)| (p.clone(), e.clone()))
            .collect();
        Manifest {
            ignored: manifest.ignored + manifest.entries.len() - entries.len(),
            entries,
            issues: manifest.issues.clone(),
        }
    }
    pub fn compare(
        &self,
        a: &Manifest,
        b: &Manifest,
        base: &Baseline,
        local: &str,
    ) -> Result<Comparison> {
        let a = self.filter(a);
        let b = self.filter(b);
        let mut result = compare(&a, &b, base);
        if let Some(source) = self.direction.source() {
            ensure!(self.contains(local), "本机不是任务端点");
            let index = usize::from(source != local);
            let manifests = [&a, &b];
            let incompatible = a
                .entries
                .keys()
                .chain(b.entries.keys())
                .filter(|p| {
                    matches!(
                        (a.entries.get(*p), b.entries.get(*p)),
                        (Some(Entry::File { .. }), Some(Entry::Directory))
                            | (Some(Entry::Directory), Some(Entry::File { .. }))
                    )
                })
                .cloned()
                .collect::<BTreeSet<_>>();
            result.changes = result
                .changes
                .into_iter()
                .filter_map(|change| {
                    let structural = incompatible.contains(&change.path)
                        || change
                            .path
                            .match_indices('/')
                            .any(|(i, _)| incompatible.contains(&change.path[..i]));
                    if structural {
                        return Some(change);
                    }
                    let after = manifests[index].entries.get(&change.path).cloned();
                    let before = manifests[1 - index].entries.get(&change.path).cloned();
                    if after.is_none() && matches!(self.direction, Direction::OneWayUpdate { .. }) {
                        return None;
                    }
                    if after.is_none()
                        && before == Some(Entry::Directory)
                        && self.protects_directory(&change.path)
                    {
                        return None;
                    }
                    let action = if after.is_none() {
                        Action::Delete
                    } else if before.is_none() {
                        Action::Create
                    } else {
                        Action::Update
                    };
                    Some(Change {
                        path: change.path,
                        target: 1 - index,
                        action,
                        before,
                        after,
                    })
                })
                .collect();
        } else {
            result.changes.retain(|c| {
                !(c.after.is_none()
                    && c.before == Some(Entry::Directory)
                    && self.protects_directory(&c.path))
            });
        }
        Ok(result)
    }
    pub fn validate_change(&self, change: &Change, local: &str, undo: bool) -> Result<()> {
        files::validate_path(&change.path)?;
        ensure!(
            !self.is_excluded(&change.path)
                && self.permits_target(self.target_device(local, change.target)?),
            "操作违反方向或排除规则"
        );
        ensure!(
            change.before != change.after && change.action != Action::Conflict,
            "操作内容无效"
        );
        let action = if change.after.is_none() {
            Action::Delete
        } else if change.before.is_none() {
            Action::Create
        } else {
            Action::Update
        };
        ensure!(change.action == action, "操作类型与内容不一致");
        ensure!(
            !matches!(
                (&change.before, &change.after),
                (Some(Entry::File { .. }), Some(Entry::Directory))
                    | (Some(Entry::Directory), Some(Entry::File { .. }))
            ),
            "结构冲突需先人工处理"
        );
        if change.after.is_none() && change.before == Some(Entry::Directory) {
            ensure!(!self.protects_directory(&change.path), "目录包含排除路径");
        }
        if !undo && matches!(self.direction, Direction::OneWayUpdate { .. }) {
            ensure!(change.after.is_some(), "单向更新不传播删除");
        }
        Ok(())
    }
    pub fn canonical_changes(
        &self,
        changes: &[Change],
        local: &str,
    ) -> Result<Vec<serde_json::Value>> {
        let mut result = changes.iter().map(|c| Ok(serde_json::json!({"path":c.path,"action":c.action,"target":self.target_device(local,c.target)?,"before":c.before,"after":c.after}))).collect::<Result<Vec<_>>>()?;
        result.sort_by_key(|v| v["path"].as_str().unwrap_or_default().to_owned());
        Ok(result)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub id: String,
    pub expected_revision: u32,
    pub next: TaskPolicy,
    pub proposed_by: String,
}
impl Proposal {
    pub fn fingerprint(&self) -> Result<String> {
        digest(self)
    }
    pub fn validate(&self, current: &TaskPolicy) -> Result<()> {
        ensure!(
            uuid::Uuid::parse_str(&self.id).is_ok_and(|v| v.to_string() == self.id),
            "提案标识无效"
        );
        self.next.validate()?;
        ensure!(
            self.next.task == current.task
                && self.next.endpoints == current.endpoints
                && self.expected_revision == current.revision
                && self.next.revision
                    == current
                        .revision
                        .checked_add(1)
                        .ok_or_else(|| anyhow::anyhow!("策略版本已耗尽"))?,
            "策略版本或端点已变化"
        );
        ensure!(
            current.can_manage(&self.proposed_by)
                || (current.trust == Trust::Unclassified && current.contains(&self.proposed_by)),
            "无权修改任务策略"
        );
        ensure!(
            self.next.trust != Trust::Unclassified,
            "不能撤回到未分类权限"
        );
        Ok(())
    }
    pub fn automatic_consent(&self, current: &TaskPolicy) -> bool {
        current.trust == self.next.trust && current.can_manage(&self.proposed_by)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct PendingPolicy {
    pub proposal: Proposal,
    pub accepted: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum ReceiptOutcome {
    Committed,
    Rejected,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct PolicyReceipt {
    pub proposal: String,
    pub digest: String,
    pub outcome: ReceiptOutcome,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct PolicyState {
    pub current: TaskPolicy,
    pub pending: Option<PendingPolicy>,
    pub last_receipt: Option<PolicyReceipt>,
}
impl PolicyState {
    pub fn ready(&self) -> Result<&TaskPolicy> {
        ensure!(self.pending.is_none(), "策略尚待双方核对");
        Ok(&self.current)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct PolicyStamp {
    pub revision: u32,
    pub digest: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct PolicyView {
    pub task: String,
    pub state: PolicyState,
    pub paused: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestProof {
    pub digest: String,
    pub files: usize,
}
impl ManifestProof {
    pub fn new(manifest: &Manifest) -> Result<Self> {
        Ok(Self {
            digest: digest(&manifest.entries)?,
            files: manifest
                .entries
                .values()
                .filter(|e| matches!(e, Entry::File { .. }))
                .count(),
        })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionOrigin {
    Manual,
    Automatic,
    Undo,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkAuthorization {
    #[serde(default)]
    pub version: u32,
    pub policy_digest: String,
    pub baseline_digest: String,
    pub origin: ExecutionOrigin,
    pub facts: BTreeMap<String, ManifestProof>,
    pub planned: Vec<Change>,
    #[serde(default)]
    pub resolutions: Vec<crate::conflicts::ConflictResolution>,
}
