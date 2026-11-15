use crate::{
    engine::Operation,
    model::{Change, Entry},
    policy::DeleteRules,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeletionWindow {
    pub started: u64,
    pub baseline_files: usize,
    pub reservations: BTreeMap<String, usize>,
}
impl DeletionWindow {
    pub fn current(&self, now: u64, files: usize, rules: &DeleteRules) -> Self {
        if (self.started == 0 && self.reservations.is_empty())
            || (now >= self.started && now - self.started >= u64::from(rules.window_seconds))
        {
            Self {
                started: now,
                baseline_files: files,
                reservations: BTreeMap::new(),
            }
        } else {
            self.clone()
        }
    }
    pub fn reserve(&mut self, batch: &str, count: usize) -> Result<()> {
        if count == 0 {
            return Ok(());
        }
        if let Some(previous) = self.reservations.get(batch) {
            ensure!(*previous == count, "删除预留与批次不一致");
        } else {
            self.reservations.insert(batch.into(), count);
        }
        Ok(())
    }
    pub fn recent(&self) -> usize {
        self.reservations
            .values()
            .fold(0usize, |sum, value| sum.saturating_add(*value))
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum RiskReason {
    LargeDeletion,
    RelativeDeletion,
    SourceEmpty,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct RiskAssessment {
    pub device: String,
    pub planned_deletions: usize,
    pub selected_deletions: usize,
    pub recent_deletions: usize,
    pub baseline_files: usize,
    pub reasons: Vec<RiskReason>,
}
pub fn is_file_delete(change: &Change) -> bool {
    matches!(change.before, Some(Entry::File { .. })) && change.after.is_none()
}
pub struct RiskSnapshot {
    pub files: usize,
    pub source_empty: bool,
    pub now: u64,
}
pub fn assess(
    device: &str,
    planned: &[Change],
    ops: &[Operation],
    snapshot: RiskSnapshot,
    window: &DeletionWindow,
    rules: &DeleteRules,
) -> RiskAssessment {
    let RiskSnapshot {
        files,
        source_empty,
        now,
    } = snapshot;
    let window = window.current(now, files, rules);
    let planned_deletions = planned
        .iter()
        .filter(|c| c.target == 0 && is_file_delete(c))
        .count();
    let selected_deletions = ops
        .iter()
        .filter(|o| o.change.target == 0 && is_file_delete(&o.change))
        .count();
    let recent = window.recent();
    let prospective = recent.saturating_add(planned_deletions);
    let mut reasons = Vec::new();
    if selected_deletions > 0 && prospective >= rules.max_files as usize {
        reasons.push(RiskReason::LargeDeletion);
    }
    if selected_deletions > 0
        && prospective >= rules.relative_min as usize
        && (prospective as u128) * 100
            >= (window.baseline_files as u128) * u128::from(rules.percent)
    {
        reasons.push(RiskReason::RelativeDeletion);
    }
    if source_empty {
        reasons.push(RiskReason::SourceEmpty);
    }
    RiskAssessment {
        device: device.into(),
        planned_deletions,
        selected_deletions,
        recent_deletions: recent,
        baseline_files: window.baseline_files,
        reasons,
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskPermit {
    pub work_digest: String,
    pub policy_digest: String,
    pub expires_at: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct ExecutionPreview {
    pub plan: String,
    pub digest: String,
    pub selection_digest: String,
    pub risks: Vec<RiskAssessment>,
    pub approval_required: bool,
    pub selected: Vec<String>,
}
