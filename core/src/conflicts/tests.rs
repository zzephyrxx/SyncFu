use super::*;
use crate::engine::Engine;
use std::fs;

#[test]
fn conflict_decisions_above_twenty_thousand_are_all_validated() -> Result<()> {
    const COUNT: usize = 20_001;
    let temp = tempfile::tempdir()?;
    let engine = Engine::open(temp.path())?;
    let local = "a".repeat(64);
    let remote = "b".repeat(64);
    let local_grant = uuid::Uuid::from_u128(1).to_string();
    let remote_grant = uuid::Uuid::from_u128(2).to_string();
    let task = Task {
        id: digest(&[&local_grant, &remote_grant])?,
        peer: remote.clone(),
        local: local_grant,
        remote: remote_grant,
        label: "large conflict review".into(),
        local_path: "local".into(),
        remote_path: "remote".into(),
    };
    let mut policy = TaskPolicy::legacy(&task, &local)?;
    policy.revision = 1;
    policy.trust = crate::policy::Trust::Personal;
    policy.validate()?;
    let versions = BTreeMap::from([
        (local.clone(), Some(files::hash_file(&b"local"[..])?)),
        (remote, Some(files::hash_file(&b"remote"[..])?)),
    ]);
    let mut resolutions = Vec::with_capacity(COUNT);
    let mut planned = Vec::with_capacity(COUNT);
    for index in 0..COUNT {
        let path = format!("conflict-{index:05}.txt");
        let resolution = ConflictResolution {
            conflict: ConflictDescriptor {
                fingerprint: conflict_fingerprint(&policy, &path, &versions)?,
                path,
                versions: versions.clone(),
                resolvable: true,
            },
            source_device: local.clone(),
        };
        planned.push(resolution.change(&policy, &local)?);
        resolutions.push(resolution);
    }
    let mut work = Work {
        batch: Batch {
            id: crate::engine::id(),
            task: task.id,
            label: task.label,
            created: crate::engine::now(),
            status: "pending".into(),
            undo_of: None,
            done: 0,
            total: COUNT,
            skipped: 0,
            message: None,
            undo_available: false,
        },
        owner: local.clone(),
        digest: String::new(),
        ops: vec![],
        common: Baseline::new(),
        authorization: Some(crate::policy::WorkAuthorization {
            version: crate::policy::SCHEMA_VERSION,
            policy_digest: policy.fingerprint()?,
            baseline_digest: String::new(),
            origin: crate::policy::ExecutionOrigin::Manual,
            facts: BTreeMap::new(),
            planned,
            resolutions,
        }),
    };
    let verified = engine.validate_resolutions(&work, &policy, &local)?;
    assert_eq!(verified.len(), COUNT);
    assert!(verified.contains_key("conflict-20000.txt"));

    let auth = work.authorization.as_mut().unwrap();
    auth.resolutions.push(auth.resolutions[0].clone());
    assert!(
        engine
            .validate_resolutions(&work, &policy, &local)
            .unwrap_err()
            .to_string()
            .contains("重复")
    );
    work.authorization.as_mut().unwrap().resolutions.pop();
    work.authorization
        .as_mut()
        .unwrap()
        .resolutions
        .last_mut()
        .unwrap()
        .conflict
        .fingerprint = "forged".into();
    assert!(engine.validate_resolutions(&work, &policy, &local).is_err());
    Ok(())
}

#[test]
fn review_notes_survive_restart_without_changing_sync_baseline() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let root = temp.path().join("folder");
    fs::create_dir(&root)?;
    let engine = Engine::open(&temp.path().join("state"))?;
    let local = "a".repeat(64);
    let remote = "b".repeat(64);
    engine.bind_device(&local)?;
    let grant = engine.grant(&remote, &root)?;
    let other = uuid::Uuid::new_v4().to_string();
    let mut grants = [grant.id.clone(), other.clone()];
    grants.sort();
    let task = Task {
        id: digest(&grants)?,
        peer: remote,
        local: grant.id,
        remote: other,
        label: "notes".into(),
        local_path: grant.path,
        remote_path: "other".into(),
    };
    engine.link_task(&task)?;
    let note = ReviewNote {
        task: task.id.clone(),
        path: "file.txt".into(),
        fingerprint: "specific-versions".into(),
        ignored: true,
    };
    engine.save_review_notes(
        &task.id,
        std::slice::from_ref(&note.path),
        std::slice::from_ref(&note),
    )?;
    assert!(engine.pair_state(&task.id)?.base.is_empty());
    drop(engine);
    let engine = Engine::open(&temp.path().join("state"))?;
    engine.bind_device(&local)?;
    assert_eq!(engine.review_notes(&task.id)?.len(), 1);
    assert!(engine.review_notes(&task.id)?[0].ignored);
    engine.clear_review_note(&task.id, &note.path)?;
    assert!(engine.review_notes(&task.id)?.is_empty());
    assert!(engine.pair_state(&task.id)?.base.is_empty());
    Ok(())
}
#[test]
fn peer_preview_cannot_substitute_another_identity_or_text() -> Result<()> {
    let expected = Some(files::hash_file(&b"approved text"[..])?);
    let mut preview = FilePreview {
        device: "peer".into(),
        entry: expected.clone(),
        text: Some("approved text".into()),
        reason: None,
    };
    validate_preview(&preview, "peer", &expected)?;
    preview.device = "other".into();
    assert!(validate_preview(&preview, "peer", &expected).is_err());
    preview.device = "peer".into();
    preview.text = Some("misleading replacement".into());
    assert!(validate_preview(&preview, "peer", &expected).is_err());
    preview.text = None;
    preview.reason = Some("too_large".into());
    assert!(validate_preview(&preview, "peer", &expected).is_err());
    Ok(())
}
#[test]
fn review_note_batch_failure_is_atomic() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let engine = Engine::open(temp.path())?;
    let good = ReviewNote {
        task: "task".into(),
        path: "one".into(),
        fingerprint: "one".into(),
        ignored: true,
    };
    let bad = ReviewNote {
        task: "another".into(),
        path: "two".into(),
        fingerprint: "two".into(),
        ignored: true,
    };
    assert!(engine.save_review_notes("task", &[], &[good, bad]).is_err());
    assert!(engine.store.list::<ReviewNote>("review_notes")?.is_empty());
    Ok(())
}
