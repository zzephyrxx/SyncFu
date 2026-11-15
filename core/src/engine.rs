use crate::{
    files::{self, Root},
    model::*,
    policy::WorkAuthorization,
    risk::DeletionWindow,
    safety::LocalPause,
    store::{self, Store},
};
use anyhow::{Context, Result, bail, ensure};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const TRANSFER_CHUNK_BYTES: usize = 1024 * 1024;
pub const TRANSFER_ENCODED_LIMIT: usize = TRANSFER_CHUNK_BYTES.div_ceil(3) * 4;

pub fn id() -> String {
    Uuid::new_v4().to_string()
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn valid_id(value: &str) -> Result<()> {
    ensure!(
        Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value),
        "无效的标识"
    );
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grant {
    pub id: String,
    pub peer: String,
    pub label: String,
    pub path: String,
    pub(crate) canonical: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub label: String,
    pub path: String,
}
impl From<Grant> for Folder {
    fn from(g: Grant) -> Self {
        Self {
            id: g.id,
            label: g.label,
            path: g.path,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub days: u32,
    pub quota: u64,
    pub location: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairState {
    pub base: Baseline,
    pub stamps: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Operation {
    pub id: String,
    pub change: Change,
    pub previous: Option<Entry>,
    pub previous_known: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Work {
    pub batch: Batch,
    pub owner: String,
    pub digest: String,
    pub ops: Vec<Operation>,
    pub common: Baseline,
    #[serde(default)]
    pub authorization: Option<WorkAuthorization>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Waiting,
    Prepared,
    Moving,
    Applied,
    Failed,
    Review,
}

pub struct Engine {
    pub(crate) store: Store,
    pub(crate) state_dir: PathBuf,
    pub(crate) gate: Mutex<()>,
    pub(crate) cancelled: AtomicBool,
    pub(crate) pauses: Mutex<LocalPause>,
    active: Mutex<Option<Arc<Work>>>,
    _lock: fs::File,
}

impl Engine {
    pub fn open(state_dir: &Path) -> Result<Self> {
        fs::create_dir_all(state_dir)?;
        let state_dir = state_dir.canonicalize()?;
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(state_dir.join("instance.lock"))?;
        fs2::FileExt::try_lock_exclusive(&lock).context("此数据目录已由另一个 SyncFu 实例使用")?;
        let store = Store::open(&state_dir.join("syncfu.sqlite3"))?;
        let active = store.get("session", "active")?.map(Arc::new);
        let pauses = Mutex::new(store.get("config", "pause")?.unwrap_or_default());
        let engine = Self {
            store,
            state_dir,
            gate: Mutex::new(()),
            cancelled: AtomicBool::new(false),
            pauses,
            active: Mutex::new(active),
            _lock: lock,
        };
        fs::create_dir_all(engine.default_backup())?;
        Ok(engine)
    }

    fn default_backup(&self) -> PathBuf {
        self.state_dir.join("backups")
    }

    pub fn settings(&self) -> Result<Settings> {
        Ok(self
            .store
            .get("config", "backup")?
            .unwrap_or_else(|| Settings {
                days: 30,
                quota: 10_000_000_000,
                location: self.default_backup().to_string_lossy().into_owned(),
            }))
    }

    pub fn set_settings(
        &self,
        days: u32,
        quota: u64,
        location: Option<PathBuf>,
    ) -> Result<Settings> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        ensure!(self.active()?.is_none(), "批次进行中，稍后修改备份设置");
        ensure!(
            (1..=3650).contains(&days) && quota >= 1_000_000,
            "备份配置超出范围"
        );
        let mut settings = self.settings()?;
        if let Some(location) = location {
            let path = location.canonicalize()?;
            ensure!(path.is_dir() && path.parent().is_some(), "请选择备份文件夹");
            self.require_disjoint(&path)?;
            let destination = path.join("SyncFu-backups");
            let source = PathBuf::from(&settings.location);
            if destination != source {
                if destination.symlink_metadata().is_ok() {
                    ensure!(
                        !destination.symlink_metadata()?.file_type().is_symlink(),
                        "备份位置不能是链接"
                    );
                    ensure!(destination.read_dir()?.next().is_none(), "新备份目录须为空");
                }
                fs::create_dir_all(&destination)?;
                for item in source.read_dir()? {
                    let item = item?;
                    if !is_hash(&item.file_name().to_string_lossy()) {
                        continue;
                    }
                    let target = destination.join(item.file_name());
                    let expected = files::hash_file(fs::File::open(item.path())?)?;
                    let mut temp = tempfile::NamedTempFile::new_in(&destination)?;
                    files::copy_checked(fs::File::open(item.path())?, &mut temp, &expected)?;
                    temp.as_file().sync_all()?;
                    temp.persist_noclobber(target)?;
                }
                settings.location = destination.canonicalize()?.to_string_lossy().into_owned();
            }
        }
        settings.days = days;
        settings.quota = quota;
        self.store.put("config", "backup", &settings)?;
        Ok(settings)
    }

    fn require_disjoint(&self, path: &Path) -> Result<()> {
        for grant in self.store.list::<Grant>("grants")? {
            ensure!(
                !overlap(path, &grant.canonical),
                "此目录与已授权的同步目录重叠"
            );
        }
        Ok(())
    }

    pub fn grant(&self, peer: &str, path: &Path) -> Result<Grant> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        let path = path.canonicalize().context("无法打开文件夹")?;
        ensure!(
            path.is_dir()
                && path.parent().is_some()
                && !overlap(&path, &self.state_dir)
                && !overlap(&path, Path::new(&self.settings()?.location)),
            "请选择与应用数据分开的本地文件夹"
        );
        if let Some(grant) = self
            .store
            .list::<Grant>("grants")?
            .into_iter()
            .find(|g| g.peer == peer && g.canonical == path)
        {
            return Ok(grant);
        }
        self.require_disjoint(&path)?;
        let grant = Grant {
            id: id(),
            peer: peer.into(),
            label: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: path.to_string_lossy().into_owned(),
            canonical: path,
        };
        let root = Root::open(&grant.canonical)?;
        let stage = root.stage()?;
        let marker = format!("grant-{}", grant.id);
        let file = stage.open_with(&marker, OpenOptions::new().create_new(true).write(true))?;
        file.sync_all()?;
        files::sync_dir(&stage)?;
        files::sync_dir(&root.dir)?;
        self.store.put("grants", &grant.id, &grant)?;
        Ok(grant)
    }

    pub fn grants(&self, peer: &str) -> Result<Vec<Folder>> {
        Ok(self
            .store
            .list::<Grant>("grants")?
            .into_iter()
            .filter(|g| g.peer == peer)
            .map(Into::into)
            .collect())
    }

    pub fn revoke_grant(&self, id: &str) -> Result<()> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        ensure!(self.active()?.is_none(), "请先结束当前批次");
        self.store.delete("grants", id)
    }

    pub fn root(&self, grant_id: &str, peer: &str) -> Result<Root> {
        let grant = self
            .store
            .get::<Grant>("grants", grant_id)?
            .context("文件夹授权已撤销")?;
        ensure!(grant.peer == peer, "对端未获此文件夹授权");
        let root = Root::open(&grant.canonical)?;
        let stage = cap_fs_ext::DirExt::open_dir_nofollow(&root.dir, files::STAGE)
            .context("同步目录标记缺失，请核对目录是否已移动")?;
        files::read_regular(&stage, &format!("grant-{}", grant.id))
            .context("同步目录标记缺失，请核对目录是否已移动")?;
        Ok(root)
    }

    pub fn tasks(&self) -> Result<Vec<Task>> {
        self.store.list("tasks")
    }
    pub fn task(&self, id: &str) -> Result<Task> {
        self.store.get("tasks", id)?.context("找不到同步任务")
    }
    pub fn pair_state(&self, task: &str) -> Result<PairState> {
        Ok(self.store.get("baseline", task)?.unwrap_or_default())
    }
    pub fn active(&self) -> Result<Option<Arc<Work>>> {
        Ok(self
            .active
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?
            .clone())
    }
    pub fn work(&self, id: &str) -> Result<Work> {
        self.store.get("work", id)?.context("找不到批次")
    }

    pub fn step(&self, work: &Work, op: &Operation) -> Result<Step> {
        Ok(self
            .store
            .get(&format!("step:{}", work.batch.id), &op.id)?
            .unwrap_or(Step::Waiting))
    }
    fn set_step(&self, work: &Work, op: &Operation, step: Step) -> Result<()> {
        self.store
            .put(&format!("step:{}", work.batch.id), &op.id, &step)
    }

    pub fn begin(&self, work: &Work, expected: &PairState) -> Result<()> {
        valid_id(&work.batch.id)?;
        let risk = self.preflight(work)?;
        self.require_risk_permit(work, &risk)?;
        ensure!(
            work.ops.len() <= files::LIMIT
                && work.common.len() <= files::LIMIT
                && work.batch.total == work.ops.len(),
            "批次条目数量无效"
        );
        ensure!(
            self.store.get::<Work>("work", &work.batch.id)?.is_none(),
            "此批次已存在，请核对结果"
        );
        ensure!(self.active()?.is_none(), "设备正在执行或核对其他批次");
        ensure!(
            &self.pair_state(&work.batch.task)? == expected,
            "同步基线已更新，请重新检查"
        );
        let task = self.task(&work.batch.task)?;
        let root = self.root(&task.local, &task.peer)?;
        ensure!(
            work.ops.windows(2).all(|pair| pair[0].id < pair[1].id),
            "操作顺序无效"
        );
        require_selected_dependencies(&work.ops)?;
        let undo_records = if let Some(original_id) = &work.batch.undo_of {
            let original = self.work(original_id)?;
            let applied: BTreeSet<_> = self.applied(original_id)?.into_iter().collect();
            ensure!(
                original.batch.task == task.id
                    && original.batch.undo_of.is_none()
                    && original.batch.created
                        >= now().saturating_sub(u64::from(self.settings()?.days) * 86_400),
                "此批次的历史已过期或不属于该任务"
            );
            original
                .ops
                .into_iter()
                .filter(|op| applied.contains(&op.id))
                .map(|op| (op.change.path.clone(), op))
                .collect::<BTreeMap<_, _>>()
        } else {
            BTreeMap::new()
        };
        let mut paths = BTreeSet::new();
        let mut ids = BTreeSet::new();
        let mut bytes = 0u64;
        for op in &work.ops {
            valid_id(&op.id)?;
            let c = &op.change;
            files::validate_path(&c.path)?;
            ensure!(
                paths.insert(files::portable_key(&c.path))
                    && ids.insert(&op.id)
                    && c.target <= 1
                    && c.action != Action::Conflict
                    && c.before != c.after,
                "无效或重复的操作"
            );
            for state in [&c.before, &c.after].into_iter().flatten() {
                if let Entry::File { sha256, bytes } = state {
                    ensure!(is_hash(sha256) && *bytes < (1u64 << 50), "文件指纹无效");
                }
            }
            if c.target == 0 {
                ensure!(
                    root.state(&c.path)? == c.before,
                    "检查后文件已改变：{}",
                    c.path
                );
                bytes = bytes.saturating_add(c.after.as_ref().map_or(0, Entry::bytes));
            } else {
                let source = if work.batch.undo_of.is_some() {
                    &c.before
                } else {
                    &c.after
                };
                ensure!(
                    &root.state(&c.path)? == source,
                    "检查后来源已改变：{}",
                    c.path
                );
            }
            if let Some(original) = &work.batch.undo_of {
                let old = undo_records
                    .get(&c.path)
                    .context("此文件没有可撤销的已完成操作")?;
                ensure!(
                    old.change.target == c.target
                        && old.change.before == c.after
                        && old.change.after == c.before
                        && old.previous_known == op.previous_known
                        && old.previous == op.previous,
                    "撤销内容与历史记录不符"
                );
                ensure!(
                    expected.stamps.get(&c.path) == Some(original),
                    "文件已有后续操作：{}",
                    c.path
                );
            }
        }
        let local: BTreeMap<_, _> = work
            .ops
            .iter()
            .filter(|op| op.change.target == 0)
            .map(|op| (op.change.path.as_str(), &op.change))
            .collect();
        for (path, change) in &local {
            if change.after.is_some() {
                for (index, _) in path.match_indices('/') {
                    let parent = &path[..index];
                    ensure!(
                        local
                            .get(parent)
                            .is_some_and(|change| change.after == Some(Entry::Directory))
                            || root.state(parent)? == Some(Entry::Directory),
                        "请同时选择父目录：{parent}"
                    );
                }
            }
            if change.before == Some(Entry::Directory) && change.after.is_none() {
                let (parent, name) = root.parent(path)?;
                let dir = cap_fs_ext::DirExt::open_dir_nofollow(&parent, &name)?;
                for child in dir.entries()? {
                    let name = child?.file_name();
                    let name = name.to_str().context("目录包含无法处理的文件名")?;
                    let child = format!("{path}/{name}");
                    ensure!(
                        local
                            .get(child.as_str())
                            .is_some_and(|entry| entry.after.is_none()),
                        "目录包含未选择删除的内容：{child}"
                    );
                }
            }
        }
        ensure!(
            fs2::available_space(&root.path)? >= bytes.saturating_add(4_194_304),
            "同步磁盘空间不足"
        );
        self.clean_backups()?;
        let policy = self.require_current_work(work)?;
        let local = self.local_device()?;
        let files = work
            .authorization
            .as_ref()
            .and_then(|a| a.facts.get(&local))
            .context("缺少本机内容证明")?
            .files;
        let mut window = self
            .store
            .get::<DeletionWindow>("delete_window", &work.batch.task)?
            .unwrap_or_default()
            .current(now(), files, &policy.deletion);
        window.reserve(&work.batch.id, risk.selected_deletions)?;
        let pause = self
            .pauses
            .lock()
            .map_err(|_| anyhow::anyhow!("暂停状态不可用"))?;
        ensure!(
            !pause.all && !pause.tasks.contains(&work.batch.task),
            "本机已暂停此任务"
        );
        self.cancelled.store(false, Ordering::Release);
        let mut db = self.store.conn();
        let tx = db.transaction()?;
        store::put(&tx, "work", &work.batch.id, work)?;
        store::put(&tx, "session", "active", work)?;
        if risk.selected_deletions > 0 {
            store::put(&tx, "delete_window", &work.batch.task, &window)?;
        }
        tx.execute(
            "DELETE FROM records WHERE bucket='risk_permit' AND key=?1",
            [&work.batch.id],
        )?;
        tx.commit()?;
        drop(db);
        *self
            .active
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))? = Some(Arc::new(work.clone()));
        drop(pause);
        let result = self.backup(work, &root);
        if let Err(e) = result {
            self.finish(work, &[], "failed", Some(e.to_string()))?;
            return Err(e);
        }
        Ok(())
    }

    fn backup(&self, work: &Work, root: &Root) -> Result<()> {
        let settings = self.settings()?;
        let location = PathBuf::from(settings.location);
        let usage: u64 = fs::read_dir(&location)?
            .filter_map(|r| r.ok())
            .filter(|r| is_hash(&r.file_name().to_string_lossy()))
            .filter_map(|r| r.metadata().ok())
            .map(|m| m.len())
            .sum();
        let mut missing = BTreeMap::new();
        for op in work.ops.iter().filter(|op| op.change.target == 0) {
            if let Some(Entry::File { sha256, bytes }) = &op.change.before {
                let destination = location.join(sha256);
                if destination.exists() {
                    ensure!(
                        files::hash_file(fs::File::open(destination)?)?
                            == *op.change.before.as_ref().context("缺少备份状态")?,
                        "备份校验失败"
                    );
                } else {
                    missing.entry(sha256).or_insert((*bytes, op));
                }
            }
        }
        let needed: u64 = missing.values().map(|(size, _)| size).sum();
        ensure!(
            needed == 0
                || (usage.saturating_add(needed) <= settings.quota
                    && fs2::available_space(&location)? >= needed.saturating_add(4_194_304)),
            "备份空间不足，相关文件尚未更改"
        );
        for (hash, (_, op)) in missing {
            let mut output = tempfile::NamedTempFile::new_in(&location)?;
            files::copy_checked(
                root.read(&op.change.path)?,
                &mut output,
                op.change.before.as_ref().context("缺少备份状态")?,
            )?;
            output.as_file().sync_all()?;
            output.persist_noclobber(location.join(hash))?;
        }
        files::sync_dir(&Dir::open_ambient_dir(
            &location,
            cap_std::ambient_authority(),
        )?)?;
        Ok(())
    }

    pub fn chunk(&self, work: &Work, op: &Operation, offset: u64, data: &[u8]) -> Result<()> {
        self.require_current_work(work)?;
        ensure!(
            op.change.target == 0
                && self.step(work, op)? == Step::Waiting
                && data.len() <= TRANSFER_CHUNK_BYTES,
            "批次不接受此文件片段"
        );
        let expected = op.change.after.as_ref().context("没有目标文件")?;
        ensure!(
            matches!(expected, Entry::File { .. })
                && offset.saturating_add(data.len() as u64) <= expected.bytes(),
            "片段超出已批准文件"
        );
        let task = self.task(&work.batch.task)?;
        let stage = self.root(&task.local, &task.peer)?.stage()?;
        let name = incoming(work, op);
        use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
        let mut file = stage.open_with(
            &name,
            OpenOptions::new()
                .write(true)
                .append(true)
                .create_new(offset == 0)
                .follow(FollowSymlinks::No),
        )?;
        ensure!(file.metadata()?.len() == offset, "文件片段偏移不一致");
        file.write_all(data)?;
        Ok(())
    }

    pub fn read_chunk(&self, work: &Work, op: &Operation, offset: u64) -> Result<Vec<u8>> {
        self.require_current_work(work)?;
        ensure!(
            op.change.target == 1 && work.batch.undo_of.is_none(),
            "此操作没有可读取的来源"
        );
        let size = op.change.after.as_ref().context("没有来源文件")?.bytes();
        ensure!(offset < size, "读取超出已批准文件");
        let task = self.task(&work.batch.task)?;
        let mut file = self.root(&task.local, &task.peer)?.read(&op.change.path)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut bytes = vec![0; (size - offset).min(TRANSFER_CHUNK_BYTES as u64) as usize];
        file.read_exact(&mut bytes)?;
        Ok(bytes)
    }

    pub fn seal(&self, work: &Work) -> Result<()> {
        self.verify_frozen_work(work)?;
        let task = self.task(&work.batch.task)?;
        let root = self.root(&task.local, &task.peer)?;
        for op in work.ops.iter().filter(|op| op.change.target == 0) {
            let c = &op.change;
            ensure!(
                root.state(&c.path)? == c.before,
                "准备期间文件已改变：{}",
                c.path
            );
            if let Some(expected @ Entry::File { sha256, bytes }) = &c.after {
                (|| -> Result<()> {
                    let stage = root.stage()?;
                    let name = incoming(work, op);
                    if work.batch.undo_of.is_some() || *bytes == 0 {
                        let mut output = stage
                            .open_with(&name, OpenOptions::new().create_new(true).write(true))?;
                        if work.batch.undo_of.is_some() {
                            files::copy_checked(
                                fs::File::open(Path::new(&self.settings()?.location).join(sha256))?,
                                &mut output,
                                expected,
                            )
                            .context("历史备份已过期或不可读")?;
                        }
                    }
                    // Windows requires a writable handle to flush file contents.
                    let file = files::open_regular(&stage, &name, true)?;
                    ensure!(files::hash_file(&file)? == *expected, "传输校验失败");
                    file.sync_all().context("无法将临时文件写入磁盘")?;
                    files::sync_dir(&stage)
                })()
                .with_context(|| format!("准备同步文件 {} 失败", c.path))?;
            }
            self.set_step(work, op, Step::Prepared)?;
        }
        for op in work.ops.iter().filter(|op| op.change.target == 1) {
            let source = if work.batch.undo_of.is_some() {
                &op.change.before
            } else {
                &op.change.after
            };
            ensure!(
                &root.state(&op.change.path)? == source,
                "准备期间来源已改变：{}",
                op.change.path
            );
        }
        Ok(())
    }

    pub fn apply(&self, work: &Work) -> Result<Option<String>> {
        self.verify_frozen_work(work)?;
        let task = self.task(&work.batch.task)?;
        let root = self.root(&task.local, &task.peer)?;
        let mut local: Vec<_> = work.ops.iter().filter(|op| op.change.target == 0).collect();
        local.sort_by_key(|op| match &op.change {
            Change {
                after: Some(Entry::Directory),
                ..
            } => (0, op.change.path.matches('/').count()),
            Change {
                before: Some(Entry::Directory),
                after: None,
                ..
            } => (2, usize::MAX - op.change.path.matches('/').count()),
            _ => (1, 0),
        });
        for op in local {
            if self.cancelled.load(Ordering::Acquire) || self.is_paused(&work.batch.task)? {
                return Ok(Some("已停止后续操作".into()));
            }
            if self.step(work, op)? != Step::Prepared {
                continue;
            }
            if let Err(error) = self.apply_item(work, op, &root) {
                if self.step(work, op)? == Step::Prepared {
                    self.set_step(work, op, Step::Failed)?;
                }
                return Ok(Some(format!("{}：{error:#}", op.change.path)));
            }
        }
        Ok(None)
    }

    fn apply_item(&self, work: &Work, op: &Operation, root: &Root) -> Result<()> {
        let c = &op.change;
        let (parent, name) = root.parent(&c.path)?;
        ensure!(
            files::entry(&parent, &name)? == c.before,
            "文件已改变，请重新检查"
        );
        let stage = root.stage()?;
        let old = saved(work, op);
        self.set_step(work, op, Step::Moving)?;
        match &c.before {
            Some(Entry::Directory) => parent.remove_dir(&name).context("目录仍包含文件")?,
            Some(before @ Entry::File { .. }) => {
                parent.rename(&name, &stage, &old)?;
                files::sync_dir(&parent)?;
                files::sync_dir(&stage)?;
                ensure!(
                    files::entry(&stage, &old)?.as_ref() == Some(before),
                    "替换时发现外部修改，原内容已保护"
                );
            }
            None => (),
        }
        match &c.after {
            Some(Entry::Directory) => parent.create_dir(&name)?,
            Some(Entry::File { .. }) => stage.hard_link(incoming(work, op), &parent, &name)?,
            None => (),
        }
        files::sync_dir(&parent)?;
        ensure!(files::entry(&parent, &name)? == c.after, "应用后校验失败");
        self.set_step(work, op, Step::Applied)?;
        Ok(())
    }

    pub fn outcome(&self, work: &Work) -> Result<Vec<(String, Step)>> {
        let task = self.task(&work.batch.task)?;
        let root = self.root(&task.local, &task.peer)?;
        let mut result = vec![];
        for op in work.ops.iter().filter(|op| op.change.target == 0) {
            let mut step = self.step(work, op)?;
            if matches!(step, Step::Moving | Step::Review) {
                step = self.recover_item(work, op, &root).unwrap_or(Step::Review);
                self.set_step(work, op, step.clone())?;
            }
            result.push((op.id.clone(), step));
        }
        Ok(result)
    }

    fn recover_item(&self, work: &Work, op: &Operation, root: &Root) -> Result<Step> {
        let c = &op.change;
        let current = root.state(&c.path)?;
        let stage = root.stage()?;
        let old = saved(work, op);
        let displaced = files::entry(&stage, &old)?;
        if current == c.after
            && (!matches!(c.before, Some(Entry::File { .. })) || displaced == c.before)
        {
            return Ok(Step::Applied);
        }
        if current.is_none() && displaced.is_some() {
            let (parent, name) = root.parent(&c.path)?;
            stage.hard_link(&old, &parent, &name)?;
            files::sync_dir(&parent)?;
            return Ok(Step::Failed);
        }
        if current == c.before && displaced.is_none() {
            return Ok(Step::Failed);
        }
        Ok(Step::Review)
    }

    pub fn finish(
        &self,
        work: &Work,
        applied: &[String],
        status: &str,
        message: Option<String>,
    ) -> Result<Batch> {
        if let Some(batch) = self.store.get::<Batch>("history", &work.batch.id)? {
            return Ok(batch);
        }
        let mut batch = work.batch.clone();
        batch.status = status.into();
        batch.message = message;
        batch.done = applied.len();
        batch.undo_available = !applied.is_empty() && batch.undo_of.is_none();
        let mut pair = self.pair_state(&batch.task)?;
        if status != "failed" {
            let applied: BTreeSet<_> = applied.iter().collect();
            for (path, entry) in &work.common {
                pair.base.insert(path.clone(), entry.clone());
            }
            for op in work.ops.iter().filter(|op| applied.contains(&op.id)) {
                let path = &op.change.path;
                if batch.undo_of.is_some() {
                    if op.previous_known {
                        pair.base.insert(path.clone(), op.previous.clone());
                    } else {
                        pair.base.remove(path);
                    }
                } else {
                    pair.base.insert(path.clone(), op.change.after.clone());
                }
                pair.stamps.insert(path.clone(), batch.id.clone());
            }
        }
        let mut db = self.store.conn();
        let tx = db.transaction()?;
        store::put(&tx, "baseline", &batch.task, &pair)?;
        store::put(&tx, "applied", &batch.id, &applied)?;
        store::put(&tx, "history", &batch.id, &batch)?;
        crate::usage::record(&tx, work, applied, status)?;
        if store::get::<Work>(&tx, "session", "active")?
            .is_some_and(|active| active.batch.id == batch.id)
        {
            tx.execute(
                "DELETE FROM records WHERE bucket='session' AND key='active'",
                [],
            )?;
        }
        tx.commit()?;
        drop(db);
        let mut active = self
            .active
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        if active.as_ref().is_some_and(|w| w.batch.id == batch.id) {
            *active = None;
        }
        drop(active);
        if let Ok(task) = self.task(&batch.task)
            && let Ok(root) = self.root(&task.local, &task.peer)
            && let Ok(stage) = cap_fs_ext::DirExt::open_dir_nofollow(&root.dir, files::STAGE)
        {
            for op in work.ops.iter().filter(|o| o.change.target == 0) {
                if !matches!(self.step(work, op), Ok(Step::Review | Step::Moving)) {
                    let _ = stage.remove_file(saved(work, op));
                    let _ = stage.remove_file(incoming(work, op));
                }
            }
        }
        Ok(batch)
    }

    pub fn history(&self) -> Result<Vec<Batch>> {
        let mut history = self.store.list::<Batch>("history")?;
        let expiry = now().saturating_sub(u64::from(self.settings()?.days) * 86_400);
        for batch in &mut history {
            batch.undo_available &= batch.created >= expiry;
        }
        if let Some(work) = self.active()? {
            let mut batch = work.batch.clone();
            batch.status = "pending".into();
            batch.message = self.store.get("pending_note", &batch.id)?;
            history.push(batch);
        }
        history.sort_by_key(|item| std::cmp::Reverse(item.created));
        Ok(history)
    }

    pub fn applied(&self, id: &str) -> Result<Vec<String>> {
        Ok(self.store.get("applied", id)?.unwrap_or_default())
    }

    pub fn clean_backups(&self) -> Result<()> {
        let settings = self.settings()?;
        let expiry = now().saturating_sub(u64::from(settings.days) * 86_400);
        let mut retained = BTreeSet::new();
        let mut expired = BTreeSet::new();
        let active = self.active()?.map(|w| w.batch.id.clone());
        for work in self.store.list::<Work>("work")? {
            let protected = active.as_ref() == Some(&work.batch.id) || work.batch.created >= expiry;
            let refs = if protected {
                &mut retained
            } else {
                &mut expired
            };
            for op in work.ops.into_iter().filter(|op| op.change.target == 0) {
                for state in [op.change.before, op.change.after].into_iter().flatten() {
                    if let Entry::File { sha256, .. } = state
                        && is_hash(&sha256)
                    {
                        refs.insert(sha256);
                    }
                }
            }
        }
        let path = Path::new(&settings.location);
        ensure!(path.canonicalize()? == path, "备份文件夹已移动或变为链接");
        let directory = Dir::open_ambient_dir(path, cap_std::ambient_authority())?;
        for hash in expired.difference(&retained) {
            match directory.remove_file(hash) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
}

fn overlap(a: &Path, b: &Path) -> bool {
    a.starts_with(b) || b.starts_with(a)
}
fn is_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn incoming(work: &Work, op: &Operation) -> String {
    format!("{}-{}.new", work.batch.id, op.id)
}
fn saved(work: &Work, op: &Operation) -> String {
    format!("{}-{}.old", work.batch.id, op.id)
}

pub fn require_selected_dependencies(ops: &[Operation]) -> Result<()> {
    for op in ops {
        if op.change.before == Some(Entry::Directory) && op.change.after.is_some() {
            bail!("文件与目录不能互相替换");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prepare(directory: &Path) -> Result<(Engine, Work, Operation, PathBuf)> {
        prepare_payload(directory, b"new")
    }

    fn prepare_payload(
        directory: &Path,
        payload: &[u8],
    ) -> Result<(Engine, Work, Operation, PathBuf)> {
        let root_path = directory.join("files");
        fs::create_dir(&root_path)?;
        fs::write(root_path.join("document.md"), b"old")?;
        let engine = Engine::open(&directory.join("state"))?;
        let local = "a".repeat(64);
        let peer = "b".repeat(64);
        engine.bind_device(&local)?;
        let grant = engine.grant(&peer, &root_path)?;
        let remote = id();
        let mut grants = [grant.id.clone(), remote.clone()];
        grants.sort();
        let task = Task {
            id: digest(&grants)?,
            peer: peer.clone(),
            local: grant.id,
            remote,
            label: "test".into(),
            local_path: grant.path,
            remote_path: "remote".into(),
        };
        engine.link_task(&task)?;
        let policy = engine.policy_state(&task.id)?.current;
        let proof = crate::policy::ManifestProof::new(
            &policy.filter(&engine.root(&task.local, &task.peer)?.scan()),
        )?;
        let before = files::hash_file(&b"old"[..])?;
        let after = files::hash_file(payload)?;
        let baseline = PairState {
            base: BTreeMap::from([("document.md".into(), Some(before.clone()))]),
            stamps: BTreeMap::new(),
        };
        engine.store.put("baseline", &task.id, &baseline)?;
        let op = Operation {
            id: id(),
            change: Change {
                path: "document.md".into(),
                action: Action::Update,
                target: 0,
                before: Some(before.clone()),
                after: Some(after),
            },
            previous: Some(before),
            previous_known: true,
        };
        let mut work = Work {
            batch: Batch {
                id: id(),
                task: task.id,
                label: "test".into(),
                created: now(),
                status: "pending".into(),
                undo_of: None,
                done: 0,
                total: 1,
                skipped: 0,
                message: None,
                undo_available: false,
            },
            owner: local.clone(),
            digest: String::new(),
            ops: vec![op.clone()],
            common: Baseline::new(),
            authorization: Some(crate::policy::WorkAuthorization {
                version: crate::policy::SCHEMA_VERSION,
                policy_digest: policy.fingerprint()?,
                baseline_digest: digest(&baseline)?,
                origin: crate::policy::ExecutionOrigin::Manual,
                facts: std::collections::BTreeMap::from([(local, proof.clone()), (peer, proof)]),
                planned: vec![op.change.clone()],
                resolutions: vec![],
            }),
        };
        work.digest = engine.work_digest(&work)?;
        engine.begin(&work, &engine.pair_state(&work.batch.task)?)?;
        assert!(
            engine
                .chunk(&work, &op, 0, &vec![0; TRANSFER_CHUNK_BYTES + 1])
                .is_err()
        );
        for (index, chunk) in payload.chunks(TRANSFER_CHUNK_BYTES).enumerate() {
            engine.chunk(&work, &op, (index * TRANSFER_CHUNK_BYTES) as u64, chunk)?;
        }
        engine.seal(&work)?;
        Ok((engine, work, op, root_path))
    }

    #[test]
    fn exact_chunk_boundary_and_remainder_preserve_content_and_backup() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let payload = vec![0xa5; TRANSFER_CHUNK_BYTES + 17];
        let (engine, work, _, path) = prepare_payload(temp.path(), &payload)?;
        assert_eq!(fs::read(path.join("document.md"))?, b"old");
        let applied = engine.apply(&work)?;
        assert!(applied.is_none(), "application failed: {applied:?}");
        assert_eq!(fs::read(path.join("document.md"))?, payload);
        assert_eq!(TRANSFER_ENCODED_LIMIT, TRANSFER_CHUNK_BYTES.div_ceil(3) * 4);
        Ok(())
    }

    #[test]
    fn recovers_move_before_install_after_restart() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let (engine, work, op, path) = prepare(temp.path())?;
        let root = Root::open(&path.canonicalize()?)?;
        let stage = root.stage()?;
        engine.set_step(&work, &op, Step::Moving)?;
        root.dir.rename("document.md", &stage, saved(&work, &op))?;
        drop(engine);

        let reopened = Engine::open(&temp.path().join("state"))?;
        let work = reopened.active()?.context("批次记录遗失")?;
        assert_eq!(
            reopened.outcome(&work)?,
            vec![(op.id.clone(), Step::Failed)]
        );
        assert_eq!(fs::read(path.join("document.md"))?, b"old");
        let finished = reopened.finish(&work, &[], "failed", None)?;
        assert_eq!(finished.done, 0);
        assert!(reopened.active()?.is_none());
        Ok(())
    }

    #[test]
    fn legacy_active_batch_can_reconcile_but_cannot_resume_writes() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let (engine, work, op, path) = prepare(temp.path())?;
        let root = Root::open(&path.canonicalize()?)?;
        engine.set_step(&work, &op, Step::Moving)?;
        root.dir
            .rename("document.md", &root.stage()?, saved(&work, &op))?;
        let mut legacy = serde_json::to_value(&work)?;
        legacy
            .as_object_mut()
            .context("工作记录不是对象")?
            .remove("authorization");
        engine.store.put("work", &work.batch.id, &legacy)?;
        engine.store.put("session", "active", &legacy)?;
        engine.store.delete("policy", &work.batch.task)?;
        engine.store.delete("config", "device")?;
        engine.store.delete("schema", "version")?;
        drop(engine);
        let engine = Engine::open(&temp.path().join("state"))?;
        engine.bind_device(&"a".repeat(64))?;
        let legacy = engine.active()?.context("旧批次遗失")?;
        assert!(legacy.authorization.is_none());
        assert!(engine.apply(&legacy).is_err());
        assert_eq!(engine.outcome(&legacy)?, vec![(op.id, Step::Failed)]);
        assert_eq!(fs::read(path.join("document.md"))?, b"old");
        engine.finish(&legacy, &[], "failed", None)?;
        assert!(engine.active()?.is_none());
        assert!(temp.path().join("state/migrations").is_dir());
        Ok(())
    }

    #[test]
    fn p1_authorization_cannot_resume_after_p2_migration() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let (engine, mut work, _, path) = prepare(temp.path())?;
        work.authorization.as_mut().context("缺少授权")?.version = 0;
        work.digest = engine.work_digest(&work)?;
        engine.store.put("work", &work.batch.id, &work)?;
        engine.store.put("session", "active", &work)?;
        engine.store.put("schema", "version", &2u32)?;
        drop(engine);
        let engine = Engine::open(&temp.path().join("state"))?;
        engine.bind_device(&"a".repeat(64))?;
        let legacy = engine.active()?.context("批次遗失")?;
        assert!(engine.apply(&legacy).is_err());
        assert_eq!(fs::read(path.join("document.md"))?, b"old");
        assert!(!engine.outcome(&legacy)?.is_empty());
        engine.finish(&legacy, &[], "failed", None)?;
        assert!(engine.active()?.is_none());
        Ok(())
    }

    #[test]
    fn pause_survives_restart_and_resume_does_not_reauthorize_stopped_work() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let (engine, work, _, path) = prepare(temp.path())?;
        engine.set_paused(Some(&work.batch.task), true)?;
        assert!(engine.apply(&work).is_err());
        drop(engine);
        let engine = Engine::open(&temp.path().join("state"))?;
        assert!(engine.is_paused(&work.batch.task)?);
        engine.set_paused(Some(&work.batch.task), false)?;
        assert!(!engine.is_paused(&work.batch.task)?);
        assert!(engine.apply(&work).is_err());
        assert_eq!(fs::read(path.join("document.md"))?, b"old");
        engine.finish(&work, &[], "cancelled", None)?;
        Ok(())
    }

    #[test]
    fn pause_between_atomic_items_preserves_partial_outcome() -> Result<()> {
        use crate::policy::ManifestProof;
        let temp = tempfile::tempdir()?;
        let (engine, mut work, _, path) = prepare(temp.path())?;
        engine.finish(&work, &[], "failed", None)?;
        fs::write(path.join("second.md"), b"old2")?;
        work.batch.id = id();
        work.batch.total = 2;
        work.ops.push(Operation {
            id: id(),
            change: Change {
                path: "second.md".into(),
                action: Action::Update,
                target: 0,
                before: Some(files::hash_file(&b"old2"[..])?),
                after: Some(files::hash_file(&b"new2"[..])?),
            },
            previous: Some(files::hash_file(&b"old2"[..])?),
            previous_known: true,
        });
        work.ops.sort_by(|a, b| a.id.cmp(&b.id));
        let task = engine.task(&work.batch.task)?;
        let mut baseline = engine.pair_state(&task.id)?;
        baseline
            .base
            .insert("second.md".into(), Some(files::hash_file(&b"old2"[..])?));
        engine.store.put("baseline", &task.id, &baseline)?;
        let local = engine.local_device()?;
        let proof = ManifestProof::new(&engine.root(&task.local, &task.peer)?.scan())?;
        let auth = work.authorization.as_mut().context("缺少授权")?;
        auth.baseline_digest = digest(&baseline)?;
        auth.facts = BTreeMap::from([(local, proof.clone()), (task.peer.clone(), proof)]);
        auth.planned = work.ops.iter().map(|op| op.change.clone()).collect();
        work.digest = engine.work_digest(&work)?;
        engine.begin(&work, &engine.pair_state(&work.batch.task)?)?;
        for op in &work.ops {
            engine.chunk(
                &work,
                op,
                0,
                if op.change.path == "second.md" {
                    b"new2"
                } else {
                    b"new"
                },
            )?;
        }
        engine.seal(&work)?;
        let root = engine.root(&task.local, &task.peer)?;
        engine.apply_item(&work, &work.ops[0], &root)?;
        engine.set_paused(Some(&task.id), true)?;
        assert!(engine.apply(&work).is_err());
        assert_eq!(
            root.state(&work.ops[0].change.path)?,
            work.ops[0].change.after
        );
        assert_eq!(
            root.state(&work.ops[1].change.path)?,
            work.ops[1].change.before
        );
        assert_eq!(
            engine.outcome(&work)?,
            vec![
                (work.ops[0].id.clone(), Step::Applied),
                (work.ops[1].id.clone(), Step::Prepared)
            ]
        );
        let batch = engine.finish(&work, &[work.ops[0].id.clone()], "partial", None)?;
        assert_eq!(batch.done, 1);
        assert_eq!(batch.status, "partial");
        assert!(
            engine
                .pair_state(&task.id)?
                .base
                .contains_key(&work.ops[0].change.path)
        );
        assert_eq!(
            engine
                .pair_state(&task.id)?
                .base
                .get(&work.ops[1].change.path),
            Some(&work.ops[1].change.before)
        );
        Ok(())
    }

    #[test]
    fn prepared_work_cannot_be_mutated_even_with_a_recomputed_digest() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let (engine, mut work, _, path) = prepare(temp.path())?;
        fs::write(path.join("unapproved.md"), b"old")?;
        work.ops[0].change.path = "unapproved.md".into();
        work.authorization.as_mut().context("缺少授权")?.planned[0].path = "unapproved.md".into();
        work.digest = engine.work_digest(&work)?;
        assert!(engine.apply(&work).is_err());
        assert_eq!(fs::read(path.join("unapproved.md"))?, b"old");
        assert_eq!(fs::read(path.join("document.md"))?, b"old");
        Ok(())
    }

    fn risky_delete(directory: &Path) -> Result<(Engine, Work, PathBuf)> {
        use crate::policy::*;
        let (engine, old, _, path) = prepare(directory)?;
        engine.finish(&old, &[], "failed", None)?;
        let local = engine.local_device()?;
        let mut next = engine.policy_state(&old.batch.task)?.current;
        next.revision = 1;
        next.trust = Trust::Personal;
        next.deletion.max_files = 1;
        next.deletion.relative_min = 1;
        next.deletion.percent = 100;
        let proposal = Proposal {
            id: id(),
            expected_revision: 0,
            next,
            proposed_by: local.clone(),
        };
        engine.offer_policy(&proposal, &local)?;
        engine.commit_policy(&old.batch.task, &proposal.id, &proposal.fingerprint()?)?;
        engine.confirm_policy(&old.batch.task, &proposal.id, &proposal.fingerprint()?)?;
        let mut work = old;
        work.batch.id = id();
        work.ops[0].change.action = Action::Delete;
        work.ops[0].change.after = None;
        let auth = work.authorization.as_mut().context("缺少授权")?;
        auth.policy_digest = engine
            .policy_state(&work.batch.task)?
            .current
            .fingerprint()?;
        auth.planned = vec![work.ops[0].change.clone()];
        work.digest = engine.work_digest(&work)?;
        Ok((engine, work, path))
    }

    #[test]
    fn deletion_permits_are_expiring_exact_and_single_use() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let (engine, work, path) = risky_delete(temp.path())?;
        assert!(
            engine
                .begin(&work, &engine.pair_state(&work.batch.task)?)
                .is_err()
        );
        assert!(engine.approve_work_risk(&work, &"c".repeat(64)).is_err());
        engine.approve_work_risk(&work, &engine.local_device()?)?;
        let mut other = work.clone();
        other.batch.id = id();
        other.digest = engine.work_digest(&other)?;
        assert!(
            engine
                .begin(&other, &engine.pair_state(&work.batch.task)?)
                .is_err()
        );
        let mut permit = engine
            .store
            .get::<crate::risk::RiskPermit>("risk_permit", &work.batch.id)?
            .context("批准遗失")?;
        permit.expires_at = now().saturating_sub(1);
        engine.store.put("risk_permit", &work.batch.id, &permit)?;
        assert!(
            engine
                .begin(&work, &engine.pair_state(&work.batch.task)?)
                .is_err()
        );
        engine.approve_work_risk(&work, &engine.local_device()?)?;
        engine.begin(&work, &engine.pair_state(&work.batch.task)?)?;
        assert!(
            engine
                .store
                .get::<crate::risk::RiskPermit>("risk_permit", &work.batch.id)?
                .is_none()
        );
        engine.seal(&work)?;
        engine.apply(&work)?;
        engine.finish(&work, &[work.ops[0].id.clone()], "completed", None)?;
        assert!(!path.join("document.md").exists());
        assert!(
            engine
                .begin(&work, &engine.pair_state(&work.batch.task)?)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn partial_commit_receipt_survives_restart_and_requires_confirmation() -> Result<()> {
        use crate::policy::*;
        let temp = tempfile::tempdir()?;
        let (engine, work, _, _) = prepare(temp.path())?;
        engine.finish(&work, &[], "failed", None)?;
        let mut next = engine.policy_state(&work.batch.task)?.current;
        next.revision = 1;
        next.trust = Trust::Personal;
        let proposal = Proposal {
            id: id(),
            expected_revision: 0,
            next,
            proposed_by: engine.local_device()?,
        };
        engine.offer_policy(&proposal, &proposal.proposed_by)?;
        engine.commit_policy(&work.batch.task, &proposal.id, &proposal.fingerprint()?)?;
        assert!(engine.policy_state(&work.batch.task)?.ready().is_err());
        drop(engine);
        let engine = Engine::open(&temp.path().join("state"))?;
        engine.commit_policy(&work.batch.task, &proposal.id, &proposal.fingerprint()?)?;
        assert!(engine.preflight(&work).is_err());
        engine.confirm_policy(&work.batch.task, &proposal.id, &proposal.fingerprint()?)?;
        engine.confirm_policy(&work.batch.task, &proposal.id, &proposal.fingerprint()?)?;
        assert_eq!(engine.policy_state(&work.batch.task)?.ready()?.revision, 1);
        assert!(engine.preflight(&work).is_err());
        Ok(())
    }

    #[test]
    fn shadow_link_and_rejected_proposal_replay_do_not_change_authority() -> Result<()> {
        use crate::policy::*;
        let temp = tempfile::tempdir()?;
        let (engine, work, _, path) = prepare(temp.path())?;
        engine.finish(&work, &[], "failed", None)?;
        let mut shadow = engine.task(&work.batch.task)?;
        shadow.remote = id();
        let mut grants = [shadow.local.clone(), shadow.remote.clone()];
        grants.sort();
        shadow.id = digest(&grants)?;
        assert!(engine.link_task(&shadow).is_err());
        let mut next = engine.policy_state(&work.batch.task)?.current;
        next.revision = 1;
        next.trust = Trust::Personal;
        let proposal = Proposal {
            id: id(),
            expected_revision: 0,
            next,
            proposed_by: "b".repeat(64),
        };
        assert!(
            !engine
                .offer_policy(&proposal, &proposal.proposed_by)?
                .pending
                .context("提案缺失")?
                .accepted
        );
        engine.answer_policy(&work.batch.task, &proposal.id, false)?;
        assert!(
            engine
                .offer_policy(&proposal, &proposal.proposed_by)?
                .pending
                .is_none()
        );
        assert_eq!(
            engine.policy_state(&work.batch.task)?.current.trust,
            Trust::Unclassified
        );
        assert_eq!(fs::read(path.join("document.md"))?, b"old");
        Ok(())
    }

    #[test]
    fn verifies_installed_file_even_if_receipt_was_not_written() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let (engine, work, op, path) = prepare(temp.path())?;
        let root = Root::open(&path.canonicalize()?)?;
        let stage = root.stage()?;
        engine.set_step(&work, &op, Step::Moving)?;
        root.dir.rename("document.md", &stage, saved(&work, &op))?;
        stage.hard_link(incoming(&work, &op), &root.dir, "document.md")?;
        drop(engine);

        let reopened = Engine::open(&temp.path().join("state"))?;
        let work = reopened.active()?.context("批次记录遗失")?;
        assert_eq!(
            reopened.outcome(&work)?,
            vec![(op.id.clone(), Step::Applied)]
        );
        let batch = reopened.finish(&work, &[op.id], "completed", None)?;
        assert_eq!(fs::read(path.join("document.md"))?, b"new");
        assert!(batch.undo_available);
        assert_eq!(
            reopened.pair_state(&batch.task)?.stamps.get("document.md"),
            Some(&batch.id)
        );
        Ok(())
    }
}
