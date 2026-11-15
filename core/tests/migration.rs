use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, params};
use std::fs;
use syncfu_core::{
    engine::Engine,
    model::{Task, digest},
    policy::{Direction, Trigger, Trust},
};

fn old_database(path: &std::path::Path) -> Result<(Connection, Task, String)> {
    fs::create_dir_all(path)?;
    let db = Connection::open(path.join("syncfu.sqlite3"))?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE records(bucket TEXT NOT NULL,key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(bucket,key)) WITHOUT ROWID;")?;
    let grants = [
        uuid::Uuid::from_u128(1).to_string(),
        uuid::Uuid::from_u128(2).to_string(),
    ];
    let task = Task {
        id: digest(&grants)?,
        peer: "b".repeat(64),
        local: grants[0].clone(),
        remote: grants[1].clone(),
        label: "legacy".into(),
        local_path: "old-local".into(),
        remote_path: "old-remote".into(),
    };
    let original = serde_json::to_string(&task)?;
    db.execute(
        "INSERT INTO records VALUES('tasks',?1,?2)",
        params![task.id, original],
    )?;
    Ok((db, task, original))
}
#[test]
fn migration_snapshots_committed_wal_and_preserves_original_records() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let (db, task, original) = old_database(temp.path())?;
    // Keep the old connection alive so the snapshot must include committed WAL data.
    let engine = Engine::open(temp.path())?;
    engine.bind_device(&"a".repeat(64))?;
    let current: String = db.query_row(
        "SELECT data FROM records WHERE bucket='tasks' AND key=?1",
        [&task.id],
        |r| r.get(0),
    )?;
    assert_eq!(current, original);
    let state = engine.policy_state(&task.id)?;
    assert_eq!(state.current.revision, 0);
    assert_eq!(state.current.trust, Trust::Unclassified);
    assert_eq!(state.current.trigger, Trigger::Manual);
    assert_eq!(state.current.direction, Direction::Bidirectional);
    let path: String = serde_json::from_str(&db.query_row::<String, _, _>(
        "SELECT data FROM records WHERE bucket='schema' AND key='snapshot'",
        [],
        |r| r.get(0),
    )?)?;
    let backup = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    assert_eq!(
        backup.query_row::<String, _, _>(
            "SELECT data FROM records WHERE bucket='tasks' AND key=?1",
            [&task.id],
            |r| r.get(0)
        )?,
        original
    );
    let version: Option<String> = backup
        .query_row(
            "SELECT data FROM records WHERE bucket='schema' AND key='version'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    assert!(version.is_none());
    drop(backup);
    drop(engine);
    let reopened = Engine::open(temp.path())?;
    reopened.bind_device(&"a".repeat(64))?;
    assert_eq!(reopened.policy_state(&task.id)?.current.revision, 0);
    assert_eq!(fs::read_dir(temp.path().join("migrations"))?.count(), 1);
    Ok(())
}
#[test]
fn unknown_future_schema_fails_without_rewriting_task_payloads() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let (db, task, original) = old_database(temp.path())?;
    db.execute("INSERT INTO records VALUES('schema','version','999')", [])?;
    assert!(Engine::open(temp.path()).is_err());
    assert_eq!(
        db.query_row::<String, _, _>(
            "SELECT data FROM records WHERE bucket='tasks' AND key=?1",
            [&task.id],
            |r| r.get(0)
        )?,
        original
    );
    assert!(!temp.path().join("migrations").exists());
    Ok(())
}
#[test]
fn p1_database_is_snapshotted_before_p2_upgrade() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let (db, task, original) = old_database(temp.path())?;
    db.execute("INSERT INTO records VALUES('schema','version','2')", [])?;
    let engine = Engine::open(temp.path())?;
    engine.bind_device(&"a".repeat(64))?;
    assert_eq!(
        db.query_row::<String, _, _>(
            "SELECT data FROM records WHERE bucket='schema' AND key='version'",
            [],
            |r| r.get(0)
        )?,
        "3"
    );
    let path: String = serde_json::from_str(&db.query_row::<String, _, _>(
        "SELECT data FROM records WHERE bucket='schema' AND key='snapshot'",
        [],
        |r| r.get(0),
    )?)?;
    let saved = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    assert_eq!(
        saved.query_row::<String, _, _>(
            "SELECT data FROM records WHERE bucket='schema' AND key='version'",
            [],
            |r| r.get(0)
        )?,
        "2"
    );
    assert_eq!(
        saved.query_row::<String, _, _>(
            "SELECT data FROM records WHERE bucket='tasks' AND key=?1",
            [&task.id],
            |r| r.get(0)
        )?,
        original
    );
    assert_eq!(
        engine.policy_state(&task.id)?.current.trust,
        Trust::Unclassified
    );
    Ok(())
}
#[test]
fn malformed_existing_policy_is_not_replaced_with_permissive_defaults() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let (db, task, _) = old_database(temp.path())?;
    db.execute("INSERT INTO records VALUES('schema','version','2')", [])?;
    db.execute(
        "INSERT INTO records VALUES('policy',?1,'{\"current\":{\"trust\":\"personal\"}}')",
        [&task.id],
    )?;
    let engine = Engine::open(temp.path())?;
    assert!(engine.bind_device(&"a".repeat(64)).is_err());
    assert!(engine.policy_state(&task.id).is_err());
    Ok(())
}
