use crate::{
    engine::{Engine, Work},
    model::Entry,
    store,
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct UsageRecord {
    pub id: String,
    pub created: f64,
    pub files: u32,
    pub bytes: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
pub struct UsageReport {
    pub enabled: bool,
    pub records: Vec<UsageRecord>,
}
impl Engine {
    pub fn usage_report(&self) -> Result<UsageReport> {
        Ok(UsageReport {
            enabled: self.store.get("config", "usage_enabled")?.unwrap_or(true),
            records: self.store.list("usage")?,
        })
    }
    pub fn set_usage_enabled(&self, enabled: bool) -> Result<()> {
        self.store.put("config", "usage_enabled", &enabled)
    }
    pub fn clear_usage(&self) -> Result<()> {
        self.store
            .conn()
            .execute("DELETE FROM records WHERE bucket='usage'", [])?;
        Ok(())
    }
}
pub(crate) fn record(
    db: &rusqlite::Connection,
    work: &Work,
    applied: &[String],
    status: &str,
) -> Result<()> {
    if work.batch.undo_of.is_some()
        || status != "completed"
        || !store::get::<bool>(db, "config", "usage_enabled")?.unwrap_or(true)
    {
        return Ok(());
    }
    let applied = applied.iter().collect::<std::collections::BTreeSet<_>>();
    let operations = work
        .ops
        .iter()
        .filter(|o| applied.contains(&o.id))
        .filter(|o| {
            matches!(o.change.before, Some(Entry::File { .. }))
                || matches!(o.change.after, Some(Entry::File { .. }))
        })
        .collect::<Vec<_>>();
    if operations.is_empty() {
        return Ok(());
    }
    let bytes: u128 = operations
        .iter()
        .filter_map(|o| match o.change.after {
            Some(Entry::File { bytes, .. }) => Some(u128::from(bytes)),
            _ => None,
        })
        .sum();
    let record = UsageRecord {
        id: work.batch.id.clone(),
        created: work.batch.created as f64,
        files: operations.len() as u32,
        bytes: bytes.to_string(),
    };
    store::put(db, "usage", &record.id, &record)
}
