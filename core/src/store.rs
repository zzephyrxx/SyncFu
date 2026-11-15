use anyhow::{Result, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

pub struct Store(Mutex<Connection>);

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        ensure!(
            rusqlite::version_number() >= 3_051_003,
            "SQLite 版本低于 3.51.3"
        );
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS records (bucket TEXT NOT NULL, key TEXT NOT NULL,
                data TEXT NOT NULL, PRIMARY KEY(bucket, key)) WITHOUT ROWID;",
        )?;
        let version: Option<u32> = get(&conn, "schema", "version")?;
        ensure!(
            version.is_none_or(|v| v == 2 || v == crate::policy::SCHEMA_VERSION),
            "不支持此状态库版本，请勿用旧程序打开新版数据"
        );
        if version != Some(crate::policy::SCHEMA_VERSION) {
            let count: i64 =
                conn.query_row("SELECT count(*) FROM records", [], |row| row.get(0))?;
            if count > 0 {
                let parent = path
                    .parent()
                    .ok_or_else(|| anyhow::anyhow!("状态库路径无效"))?
                    .join("migrations");
                std::fs::create_dir_all(&parent)?;
                let snapshot =
                    parent.join(format!("before-policy-{}.sqlite3", uuid::Uuid::new_v4()));
                conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()])?;
                put(
                    &conn,
                    "schema",
                    "snapshot",
                    &snapshot.to_string_lossy().to_string(),
                )?;
            }
            put(&conn, "schema", "version", &crate::policy::SCHEMA_VERSION)?;
        }
        Ok(Self(Mutex::new(conn)))
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn get<T: DeserializeOwned>(&self, bucket: &str, key: &str) -> Result<Option<T>> {
        get(&self.conn(), bucket, key)
    }
    pub fn put(&self, bucket: &str, key: &str, value: &impl Serialize) -> Result<()> {
        put(&self.conn(), bucket, key, value)
    }
    pub fn list<T: DeserializeOwned>(&self, bucket: &str) -> Result<Vec<T>> {
        let db = self.conn();
        let mut q = db.prepare("SELECT data FROM records WHERE bucket=?1 ORDER BY key")?;
        let rows = q.query_map([bucket], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    pub fn delete(&self, bucket: &str, key: &str) -> Result<()> {
        self.conn().execute(
            "DELETE FROM records WHERE bucket=?1 AND key=?2",
            params![bucket, key],
        )?;
        Ok(())
    }
}

pub fn get<T: DeserializeOwned>(db: &Connection, bucket: &str, key: &str) -> Result<Option<T>> {
    let value: Option<String> = db
        .query_row(
            "SELECT data FROM records WHERE bucket=?1 AND key=?2",
            params![bucket, key],
            |r| r.get(0),
        )
        .optional()?;
    value
        .map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
}
pub fn put(db: &Connection, bucket: &str, key: &str, value: &impl Serialize) -> Result<()> {
    db.execute(
        "INSERT INTO records VALUES (?1,?2,?3)
        ON CONFLICT(bucket,key) DO UPDATE SET data=excluded.data",
        params![bucket, key, serde_json::to_string(value)?],
    )?;
    Ok(())
}
