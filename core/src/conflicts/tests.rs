use super::*;
use crate::engine::Engine;
use std::fs;
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
