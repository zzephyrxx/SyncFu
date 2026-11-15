use std::collections::BTreeMap;
use syncfu_core::{engine::Operation, model::*, policy::*, risk::*};

fn file(hash: char) -> Entry {
    Entry::File {
        sha256: hash.to_string().repeat(64),
        bytes: 1,
    }
}
fn manifest(items: &[(&str, Entry)]) -> Manifest {
    Manifest {
        entries: items
            .iter()
            .map(|(p, e)| (p.to_string(), e.clone()))
            .collect(),
        ..Manifest::default()
    }
}
fn policy() -> TaskPolicy {
    let grants = [
        uuid::Uuid::from_u128(1).to_string(),
        uuid::Uuid::from_u128(2).to_string(),
    ];
    TaskPolicy {
        task: digest(&grants).unwrap(),
        revision: 1,
        endpoints: [
            Endpoint {
                device: "a".repeat(64),
                grant: grants[0].clone(),
            },
            Endpoint {
                device: "b".repeat(64),
                grant: grants[1].clone(),
            },
        ],
        direction: Direction::Bidirectional,
        trigger: Trigger::Manual,
        trust: Trust::Personal,
        conflicts: ConflictRule::Hold,
        excludes: vec![],
        deletion: DeleteRules::default(),
    }
}
fn deletion(path: &str) -> Change {
    Change {
        path: path.into(),
        action: Action::Delete,
        target: 0,
        before: Some(file('a')),
        after: None,
    }
}
fn op(change: Change) -> Operation {
    Operation {
        id: uuid::Uuid::new_v4().to_string(),
        change,
        previous: None,
        previous_known: false,
    }
}

#[test]
fn policy_and_device_ids_are_strictly_bound() {
    let mut p = policy();
    p.validate().unwrap();
    p.endpoints.swap(0, 1);
    assert!(p.validate().is_err());
    let mut p = policy();
    p.endpoints[0].device = "C".repeat(64);
    assert!(p.validate().is_err());
    let mut p = policy();
    p.direction = Direction::OneWayMirror {
        source_device: "c".repeat(64),
    };
    assert!(p.validate().is_err());
    let mut p = policy();
    p.deletion.max_files = 0;
    assert!(p.validate().is_err());
}
#[test]
fn unclassified_is_not_implicit_personal_trust() {
    let mut p = policy();
    p.revision = 0;
    p.trust = Trust::Unclassified;
    p.validate().unwrap();
    assert!(!p.can_manage(&p.endpoints[0].device));
    p.trigger = Trigger::OnChange;
    assert!(p.validate().is_err());
}
#[test]
fn one_way_update_preserves_destination_extras_and_ignores_source_deletions() {
    let mut p = policy();
    p.direction = Direction::OneWayUpdate {
        source_device: "a".repeat(64),
    };
    let a = manifest(&[("new.txt", file('a')), ("changed.txt", file('b'))]);
    let b = manifest(&[("extra.txt", file('c')), ("changed.txt", file('c'))]);
    let result = p
        .compare(&a, &b, &BTreeMap::new(), &"a".repeat(64))
        .unwrap();
    assert_eq!(result.changes.len(), 2);
    assert!(
        result
            .changes
            .iter()
            .all(|c| c.target == 1 && c.after.is_some())
    );
    assert!(
        result
            .changes
            .iter()
            .any(|c| c.path == "changed.txt" && c.action == Action::Update)
    );
    assert!(
        p.compare(&Manifest::default(), &b, &BTreeMap::new(), &"a".repeat(64))
            .unwrap()
            .changes
            .is_empty()
    );
}
#[test]
fn one_way_views_canonicalize_to_identical_target_devices() {
    let mut p = policy();
    p.direction = Direction::OneWayMirror {
        source_device: "a".repeat(64),
    };
    let a = manifest(&[("keep.txt", file('a'))]);
    let b = manifest(&[("extra.txt", file('b'))]);
    let left = p
        .compare(&a, &b, &BTreeMap::new(), &"a".repeat(64))
        .unwrap();
    let right = p
        .compare(&b, &a, &BTreeMap::new(), &"b".repeat(64))
        .unwrap();
    assert!(left.changes.iter().all(|c| c.target == 1));
    assert!(right.changes.iter().all(|c| c.target == 0));
    assert_eq!(
        p.canonical_changes(&left.changes, &"a".repeat(64)).unwrap(),
        p.canonical_changes(&right.changes, &"b".repeat(64))
            .unwrap()
    );
}
#[test]
fn structural_conflicts_are_not_forced_into_authoritative_overwrites() {
    let mut p = policy();
    p.direction = Direction::OneWayMirror {
        source_device: "a".repeat(64),
    };
    let a = manifest(&[("item", file('a'))]);
    let b = manifest(&[("item", Entry::Directory), ("item/child", file('b'))]);
    assert!(
        p.compare(&a, &b, &BTreeMap::new(), &"a".repeat(64))
            .unwrap()
            .changes
            .iter()
            .all(|c| c.action == Action::Conflict)
    );
}
#[test]
fn excluded_subtrees_are_preserved_during_mirror_cleanup() {
    let mut p = policy();
    p.direction = Direction::OneWayMirror {
        source_device: "a".repeat(64),
    };
    p.excludes = vec!["folder/private".into()];
    p.validate().unwrap();
    let b = manifest(&[
        ("folder", Entry::Directory),
        ("folder/private", Entry::Directory),
        ("folder/private/file", file('b')),
    ]);
    assert!(
        p.compare(&Manifest::default(), &b, &BTreeMap::new(), &"a".repeat(64))
            .unwrap()
            .changes
            .is_empty()
    );
    assert!(p.is_excluded("FOLDER/private/file"));
    p.excludes.push("FOLDER/PRIVATE".into());
    assert!(p.validate().is_err());
}
#[test]
fn fake_action_and_reverse_target_are_rejected() {
    let mut p = policy();
    p.direction = Direction::OneWayMirror {
        source_device: "a".repeat(64),
    };
    let mut change = deletion("file");
    assert!(p.validate_change(&change, &"a".repeat(64), false).is_err());
    change.target = 1;
    change.action = Action::Create;
    assert!(p.validate_change(&change, &"a".repeat(64), false).is_err());
    change.action = Action::Delete;
    assert!(p.validate_change(&change, &"a".repeat(64), false).is_ok());
}
#[test]
fn conflicting_preference_cannot_override_a_one_way_source() {
    let mut p = policy();
    p.direction = Direction::OneWayUpdate {
        source_device: "a".repeat(64),
    };
    p.conflicts = ConflictRule::PreferDevice {
        device: "b".repeat(64),
    };
    assert!(p.validate().is_err());
}
#[test]
fn shared_permissions_and_revision_cas_are_enforced() {
    let mut p = policy();
    p.trust = Trust::Shared {
        owner_device: "a".repeat(64),
    };
    let mut next = p.clone();
    next.revision = 2;
    let mut proposal = Proposal {
        id: uuid::Uuid::new_v4().to_string(),
        expected_revision: 1,
        next,
        proposed_by: "b".repeat(64),
    };
    assert!(proposal.validate(&p).is_err());
    proposal.proposed_by = "a".repeat(64);
    proposal.validate(&p).unwrap();
    assert!(proposal.automatic_consent(&p));
    proposal.expected_revision = 0;
    assert!(proposal.validate(&p).is_err());
}
#[test]
fn first_classification_and_changed_trust_require_explicit_consent() {
    let mut old = policy();
    old.revision = 0;
    old.trust = Trust::Unclassified;
    let next = policy();
    let mut proposal = Proposal {
        id: uuid::Uuid::new_v4().to_string(),
        expected_revision: 0,
        next,
        proposed_by: "a".repeat(64),
    };
    proposal.validate(&old).unwrap();
    assert!(!proposal.automatic_consent(&old));
    let old = policy();
    proposal.expected_revision = 1;
    proposal.next.revision = 2;
    proposal.next.trust = Trust::Shared {
        owner_device: "a".repeat(64),
    };
    proposal.validate(&old).unwrap();
    assert!(!proposal.automatic_consent(&old));
}
#[test]
fn complete_deletion_plan_cannot_be_split_into_safe_looking_nines() {
    let planned = (0..103)
        .map(|i| deletion(&format!("{i}.txt")))
        .collect::<Vec<_>>();
    let ops = planned[..9].iter().cloned().map(op).collect::<Vec<_>>();
    let risk = assess(
        "local",
        &planned,
        &ops,
        RiskSnapshot {
            files: 1000,
            source_empty: false,
            now: 100,
        },
        &DeletionWindow::default(),
        &DeleteRules::default(),
    );
    assert_eq!(risk.selected_deletions, 9);
    assert_eq!(risk.planned_deletions, 103);
    assert!(risk.reasons.contains(&RiskReason::LargeDeletion));
    let safe = assess(
        "local",
        &planned,
        &[],
        RiskSnapshot {
            files: 1000,
            source_empty: false,
            now: 100,
        },
        &DeletionWindow::default(),
        &DeleteRules::default(),
    );
    assert!(safe.reasons.is_empty());
}
#[test]
fn deletion_budget_survives_small_batches_retries_and_restarts() {
    let rules = DeleteRules::default();
    let mut window = DeletionWindow::default().current(100, 1000, &rules);
    let planned = (0..9)
        .map(|i| deletion(&format!("{i}.txt")))
        .collect::<Vec<_>>();
    let ops = planned.iter().cloned().map(op).collect::<Vec<_>>();
    for i in 0..11 {
        assert!(
            assess(
                "local",
                &planned,
                &ops,
                RiskSnapshot {
                    files: 1000 - i * 9,
                    source_empty: false,
                    now: 101
                },
                &window,
                &rules
            )
            .reasons
            .is_empty()
        );
        window.reserve(&format!("batch-{i}"), 9).unwrap();
        window.reserve(&format!("batch-{i}"), 9).unwrap();
        window = serde_json::from_str(&serde_json::to_string(&window).unwrap()).unwrap();
    }
    assert_eq!(window.recent(), 99);
    assert_eq!(window.baseline_files, 1000);
    assert!(
        assess(
            "local",
            &planned,
            &ops,
            RiskSnapshot {
                files: 901,
                source_empty: false,
                now: 102
            },
            &window,
            &rules
        )
        .reasons
        .contains(&RiskReason::LargeDeletion)
    );
}
#[test]
fn clocks_do_not_clear_deletion_budgets_on_rollback_or_epoch_zero() {
    let rules = DeleteRules::default();
    let mut window = DeletionWindow::default().current(100, 100, &rules);
    window.reserve("one", 9).unwrap();
    assert_eq!(window.current(90, 1, &rules).recent(), 9);
    assert_eq!(window.current(699, 1, &rules).baseline_files, 100);
    assert_eq!(window.current(700, 91, &rules).recent(), 0);
    let mut zero = DeletionWindow::default().current(0, 100, &rules);
    zero.reserve("one", 9).unwrap();
    assert_eq!(zero.current(0, 1, &rules).recent(), 9);
}
#[test]
fn source_empty_and_relative_thresholds_are_explicit_reasons() {
    let planned = (0..10)
        .map(|i| deletion(&format!("{i}")))
        .collect::<Vec<_>>();
    let ops = planned.iter().cloned().map(op).collect::<Vec<_>>();
    let result = assess(
        "local",
        &planned,
        &ops,
        RiskSnapshot {
            files: 50,
            source_empty: true,
            now: 100,
        },
        &DeletionWindow::default(),
        &DeleteRules::default(),
    );
    assert!(result.reasons.contains(&RiskReason::RelativeDeletion));
    assert!(result.reasons.contains(&RiskReason::SourceEmpty));
}
#[test]
fn object_key_order_never_changes_contract_digests() {
    let a: serde_json::Value = serde_json::from_str(r#"{"z":1,"a":{"y":2,"b":3}}"#).unwrap();
    let b: serde_json::Value = serde_json::from_str(r#"{"a":{"b":3,"y":2},"z":1}"#).unwrap();
    assert_eq!(digest(&a).unwrap(), digest(&b).unwrap());
}
