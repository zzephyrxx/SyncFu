use crate::model::{Entry, Manifest};
use anyhow::{Context, Result, bail, ensure};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, File, OpenOptions},
};
use sha2::{Digest, Sha256};
use std::{
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use unicode_normalization::UnicodeNormalization;

pub const STAGE: &str = ".syncfu-stage";
pub const LIMIT: usize = 20_000;

pub fn portable_key(path: &str) -> String {
    path.nfc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .nfc()
        .collect()
}

pub fn validate_path(path: &str) -> Result<()> {
    ensure!(!path.is_empty() && path.len() <= 4096, "路径为空或过长");
    for part in path.split('/') {
        let name = part
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let device = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&name.as_str())
            || ["COM", "LPT"].iter().any(|p| {
                name.strip_prefix(p).is_some_and(|n| {
                    matches!(
                        n,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            });
        ensure!(
            !part.is_empty()
                && part != "."
                && part != ".."
                && !device
                && !part.ends_with([' ', '.'])
                && part.encode_utf16().count() <= 255
                && !part
                    .chars()
                    .any(|c| c.is_control() || "<>:\"\\|?*".contains(c))
                && !part.eq_ignore_ascii_case(STAGE),
            "不支持的路径：{path}"
        );
    }
    Ok(())
}

pub fn ignored(name: &str) -> bool {
    name.eq_ignore_ascii_case(STAGE)
        || matches!(name, ".DS_Store" | "Thumbs.db" | "desktop.ini")
        || name.starts_with("~$")
}

pub struct Root {
    pub path: PathBuf,
    pub dir: Dir,
}

impl Root {
    pub fn open(path: &Path) -> Result<Self> {
        let canonical = path.canonicalize().context("同步目录已移动或无法读取")?;
        ensure!(canonical == path, "同步目录已改变位置或变为链接");
        Ok(Self {
            path: path.to_owned(),
            dir: Dir::open_ambient_dir(path, ambient_authority())?,
        })
    }

    pub fn parent(&self, path: &str) -> Result<(Dir, String)> {
        validate_path(path)?;
        let mut dir = self.dir.try_clone()?;
        let mut parts = path.split('/').peekable();
        while let Some(part) = parts.next() {
            if parts.peek().is_none() {
                return Ok((dir, part.into()));
            }
            dir = dir.open_dir_nofollow(part)?;
        }
        bail!("空路径")
    }

    pub fn stage(&self) -> Result<Dir> {
        match self.dir.create_dir(STAGE) {
            Ok(()) => (),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e.into()),
        }
        self.dir.open_dir_nofollow(STAGE).map_err(Into::into)
    }

    pub fn read(&self, path: &str) -> Result<File> {
        let (dir, name) = self.parent(path)?;
        read_regular(&dir, &name)
    }

    pub fn state(&self, path: &str) -> Result<Option<Entry>> {
        let (dir, name) = match self.parent(path) {
            Ok(pair) => pair,
            Err(e)
                if e.downcast_ref::<io::Error>()
                    .is_some_and(|e| e.kind() == io::ErrorKind::NotFound) =>
            {
                return Ok(None);
            }
            Err(e) => return Err(e),
        };
        entry(&dir, &name)
    }

    pub fn scan(&self) -> Manifest {
        self.scan_with_workers(std::thread::available_parallelism().map_or(1, |n| n.get().min(4)))
    }

    /// Every file is still content-hashed. Workers only overlap independent reads;
    /// metadata is never treated as proof that file contents are unchanged.
    pub fn scan_with_workers(&self, workers: usize) -> Manifest {
        let mut out = Manifest::default();
        let mut jobs = Vec::new();
        let directory = match self.dir.try_clone() {
            Ok(dir) => Arc::new(dir),
            Err(error) => {
                out.issues.push(error.to_string());
                return out;
            }
        };
        collect_scan(&directory, "", &mut out, &mut jobs, 0);
        if jobs.is_empty() {
            return out;
        }
        let workers = workers.clamp(1, 4).min(jobs.len());
        let results = std::thread::scope(|scope| {
            let handles = jobs
                .chunks(jobs.len().div_ceil(workers))
                .map(|chunk| {
                    scope.spawn(move || {
                        let mut buffer = vec![0u8; 128 * 1024];
                        chunk
                            .iter()
                            .map(|job| {
                                let result = open_checked(&job.dir, &job.name, false)
                                    .and_then(|file| hash_buffered(file, &mut buffer));
                                (job.path.clone(), result)
                            })
                            .collect::<Vec<_>>()
                    })
                })
                .collect::<Vec<_>>();
            handles.into_iter().map(|h| h.join()).collect::<Vec<_>>()
        });
        for result in results {
            match result {
                Ok(files) => {
                    for (path, result) in files {
                        match result {
                            Ok(entry) => {
                                out.entries.insert(path, entry);
                            }
                            Err(error) => {
                                if out.issues.len() < 201 {
                                    out.issues.push(format!("{path}：{error}"));
                                }
                            }
                        }
                    }
                }
                Err(_) => out.issues.push("文件校验线程异常，检查未完成".into()),
            }
        }
        out
    }
}

pub fn read_regular(dir: &Dir, name: &str) -> Result<File> {
    open_regular(dir, name, false)
}

pub fn open_regular(dir: &Dir, name: &str, write: bool) -> Result<File> {
    let md = dir.symlink_metadata(name)?;
    ensure!(md.is_file() && !reparse(&md), "不是普通文件：{name}");
    open_checked(dir, name, write)
}

fn open_checked(dir: &Dir, name: &str, write: bool) -> Result<File> {
    let file = dir.open_with(
        name,
        OpenOptions::new()
            .read(true)
            .write(write)
            .follow(FollowSymlinks::No),
    )?;
    let md = file.metadata()?;
    ensure!(md.is_file() && !reparse(&md), "不是普通文件：{name}");
    Ok(file)
}

#[cfg(windows)]
fn reparse(meta: &cap_std::fs::Metadata) -> bool {
    use cap_std::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn reparse(_: &cap_std::fs::Metadata) -> bool {
    false
}

pub fn entry(dir: &Dir, name: &str) -> Result<Option<Entry>> {
    match dir.symlink_metadata(name) {
        Ok(md) if md.is_dir() && !reparse(&md) => Ok(Some(Entry::Directory)),
        Ok(_) => Ok(Some(hash_file(read_regular(dir, name)?)?)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn hash_file(mut file: impl Read) -> Result<Entry> {
    let mut sha = Sha256::new();
    let bytes = io::copy(&mut file, &mut sha)?;
    Ok(Entry::File {
        sha256: hex::encode(sha.finalize()),
        bytes,
    })
}

pub fn copy_checked(mut source: impl Read, mut out: impl Write, expected: &Entry) -> Result<()> {
    let mut sha = Sha256::new();
    let mut buf = vec![0; 128 * 1024];
    let mut bytes = 0;
    loop {
        let n = source.read(&mut buf)?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        ensure!(bytes <= expected.bytes(), "文件大小已改变");
        out.write_all(&buf[..n])?;
        sha.update(&buf[..n]);
    }
    ensure!(
        &Entry::File {
            sha256: hex::encode(sha.finalize()),
            bytes
        } == expected,
        "文件内容已改变"
    );
    Ok(())
}

pub fn sync_dir(dir: &Dir) -> Result<()> {
    #[cfg(unix)]
    dir.open(".")?.sync_all()?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

struct ScanJob {
    dir: Arc<Dir>,
    name: String,
    path: String,
}
fn hash_buffered(mut file: impl Read, buffer: &mut [u8]) -> Result<Entry> {
    let mut sha = Sha256::new();
    let mut bytes = 0u64;
    loop {
        let count = file.read(buffer)?;
        if count == 0 {
            break;
        }
        bytes = bytes
            .checked_add(count as u64)
            .context("文件大小超出限制")?;
        sha.update(&buffer[..count]);
    }
    Ok(Entry::File {
        sha256: hex::encode(sha.finalize()),
        bytes,
    })
}
fn collect_scan(
    dir: &Arc<Dir>,
    prefix: &str,
    out: &mut Manifest,
    jobs: &mut Vec<ScanJob>,
    depth: usize,
) {
    if depth > 96 {
        out.issues.push(format!("目录层级过深：{prefix}"));
        return;
    }
    let entries = match dir.entries() {
        Ok(entries) => entries,
        Err(error) => {
            out.issues.push(format!("无法读取目录 {prefix}：{error}"));
            return;
        }
    };
    for item in entries {
        if out.entries.len() + jobs.len() >= LIMIT || out.issues.len() >= 200 {
            if out.issues.len() < 201 {
                out.issues.push("扫描达到条目上限".into());
            }
            return;
        }
        let item = match item {
            Ok(item) => item,
            Err(error) => {
                out.issues.push(error.to_string());
                continue;
            }
        };
        let name = item.file_name();
        let Some(name) = name.to_str() else {
            out.issues.push("发现非 Unicode 文件名".into());
            continue;
        };
        if ignored(name) {
            out.ignored += 1;
            continue;
        }
        let path = if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}/{name}")
        };
        let metadata = match validate_path(&path)
            .and_then(|_| dir.symlink_metadata(name).map_err(Into::into))
        {
            Ok(metadata) => metadata,
            Err(error) => {
                out.issues.push(format!("{path}：{error}"));
                continue;
            }
        };
        if reparse(&metadata) || metadata.file_type().is_symlink() {
            out.issues.push(format!("不是普通文件或目录：{path}"));
            continue;
        }
        if metadata.is_dir() {
            out.entries.insert(path.clone(), Entry::Directory);
            match dir.open_dir_nofollow(name) {
                Ok(child) => collect_scan(&Arc::new(child), &path, out, jobs, depth + 1),
                Err(error) => out.issues.push(format!("{path}：{error}")),
            }
        } else if metadata.is_file() {
            jobs.push(ScanJob {
                dir: dir.clone(),
                name: name.to_owned(),
                path,
            });
        } else {
            out.issues.push(format!("不是普通文件：{path}"));
        }
    }
}
