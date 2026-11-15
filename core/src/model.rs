use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub type Entries = BTreeMap<String, Entry>;
pub type Baseline = BTreeMap<String, Option<Entry>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(ts_rs::TS))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Entry {
    File {
        sha256: String,
        #[cfg_attr(feature = "bindings", ts(type = "number"))]
        bytes: u64,
    },
    Directory,
}

impl Entry {
    pub fn bytes(&self) -> u64 {
        match self {
            Self::File { bytes, .. } => *bytes,
            Self::Directory => 0,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub entries: Entries,
    pub ignored: usize,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Create,
    Update,
    Delete,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Change {
    pub path: String,
    pub action: Action,
    pub target: usize,
    pub before: Option<Entry>,
    pub after: Option<Entry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comparison {
    pub changes: Vec<Change>,
    pub same: usize,
    pub total: usize,
    pub ignored: usize,
    pub issues: Vec<String>,
}

pub fn compare(a: &Manifest, b: &Manifest, base: &Baseline) -> Comparison {
    let mut result = Comparison {
        changes: vec![],
        same: 0,
        total: 0,
        ignored: a.ignored + b.ignored,
        issues: a.issues.iter().chain(&b.issues).cloned().collect(),
    };
    let keys: BTreeSet<_> = a.entries.keys().chain(b.entries.keys()).collect();
    let mut portable = BTreeMap::new();
    let incompatible = keys
        .iter()
        .filter(|key| {
            matches!(
                (a.entries.get(key.as_str()), b.entries.get(key.as_str())),
                (Some(Entry::Directory), Some(Entry::File { .. }))
                    | (Some(Entry::File { .. }), Some(Entry::Directory))
            )
        })
        .map(|key| key.as_str())
        .collect::<BTreeSet<_>>();
    for key in keys {
        let alias = crate::files::portable_key(key);
        if let Some(old) = portable.insert(alias, key) {
            result.issues.push(format!("文件名冲突：{old} / {key}"));
        }
        let left = a.entries.get(key);
        let right = b.entries.get(key);
        let has_file = [left, right]
            .iter()
            .any(|e| matches!(e, Some(Entry::File { .. })));
        result.total += usize::from(has_file);
        if left == right {
            result.same += usize::from(has_file);
            continue;
        }
        let direction = if incompatible.contains(key.as_str())
            || key
                .match_indices('/')
                .any(|(index, _)| incompatible.contains(&key[..index]))
        {
            None
        } else if let Some(previous) = base.get(key) {
            match (left == previous.as_ref(), right == previous.as_ref()) {
                (true, false) => Some(0),
                (false, true) => Some(1),
                _ => None,
            }
        } else {
            match (left, right) {
                (None, Some(_)) => Some(0),
                (Some(_), None) => Some(1),
                _ => None,
            }
        };
        let (action, target, before, after) = match direction {
            Some(target) => {
                let (before, after) = if target == 0 {
                    (left, right)
                } else {
                    (right, left)
                };
                let action = if after.is_none() {
                    Action::Delete
                } else if before.is_none() {
                    Action::Create
                } else {
                    Action::Update
                };
                (action, target, before, after)
            }
            None => (Action::Conflict, 0, left, right),
        };
        result.changes.push(Change {
            path: key.clone(),
            action,
            target,
            before: before.cloned(),
            after: after.cloned(),
        });
    }
    result
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub peer: String,
    pub local: String,
    pub remote: String,
    pub label: String,
    pub local_path: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub task: Task,
    pub comparison: Comparison,
    pub digest: String,
    pub undo_of: Option<String>,
    pub policy: crate::policy::PolicyStamp,
    pub conflicts: Vec<crate::conflicts::ConflictDescriptor>,
    pub resolutions: Vec<crate::conflicts::ConflictResolution>,
    pub review_notes: Vec<crate::conflicts::ReviewNote>,
    #[serde(skip)]
    pub(crate) original_changes: Vec<Change>,
    #[serde(skip)]
    pub(crate) facts: BTreeMap<String, crate::policy::ManifestProof>,
    pub(crate) baseline: Baseline,
    pub(crate) common: Baseline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Batch {
    pub id: String,
    pub task: String,
    pub label: String,
    pub created: u64,
    pub status: String,
    pub undo_of: Option<String>,
    pub done: usize,
    pub total: usize,
    pub skipped: usize,
    pub message: Option<String>,
    pub undo_available: bool,
}

pub fn digest(value: &impl Serialize) -> anyhow::Result<String> {
    fn canonical(value: serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(object) => {
                let sorted = object
                    .into_iter()
                    .map(|(k, v)| (k, canonical(v)))
                    .collect::<BTreeMap<_, _>>();
                serde_json::Value::Object(sorted.into_iter().collect())
            }
            serde_json::Value::Array(array) => {
                serde_json::Value::Array(array.into_iter().map(canonical).collect())
            }
            other => other,
        }
    }
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(
        &canonical(serde_json::to_value(value)?),
    )?)))
}
