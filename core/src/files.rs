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
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc::sync_channel,
    },
    time::{Duration, Instant},
};
use unicode_normalization::UnicodeNormalization;

pub const STAGE: &str = ".syncfu-stage";
pub const LIMIT: usize = 20_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanPhase {
    #[default]
    Discovering,
    Hashing,
    Complete,
}

/// Counts describe observed work, never an estimate of undiscovered files.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct ScanProgress {
    pub phase: ScanPhase,
    pub current_path: String,
    pub directories: u64,
    pub files_total: u64,
    pub files_hashed: u64,
    pub bytes_hashed: u64,
}

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
        self.scan_with_progress(|_| {})
    }

    pub fn scan_with_progress(&self, progress: impl FnMut(&ScanProgress)) -> Manifest {
        self.scan_with_workers_and_progress(
            std::thread::available_parallelism().map_or(1, |n| n.get().min(4)),
            progress,
        )
    }

    /// Every file is content-hashed. At most four workers overlap reads; queued
    /// work contains paths, never directory/file handles. Each reopen resolves
    /// every component relative to the authorized root without following links.
    pub fn scan_with_workers(&self, workers: usize) -> Manifest {
        self.scan_with_workers_and_progress(workers, |_| {})
    }

    fn scan_with_workers_and_progress(
        &self,
        workers: usize,
        mut report: impl FnMut(&ScanProgress),
    ) -> Manifest {
        let mut out = Manifest::default();
        let mut progress = ScanProgress::default();
        report(&progress);
        let jobs = collect_scan(self, &mut out, &mut progress, &mut report);
        if !jobs.is_empty() {
            progress.phase = ScanPhase::Hashing;
            progress.current_path.clear();
            report(&progress);
            let workers = workers.clamp(1, 4).min(jobs.len());
            let next = AtomicUsize::new(0);
            std::thread::scope(|scope| {
                // Bound both active filesystem reads and pending reports. A slow
                // observer applies backpressure instead of growing a queue.
                let (sender, receiver) = sync_channel(workers * 2);
                let mut handles = Vec::with_capacity(workers);
                for _ in 0..workers {
                    let sender = sender.clone();
                    let jobs = &jobs;
                    let next = &next;
                    handles.push(scope.spawn(move || {
                        let mut buffer = vec![0u8; 128 * 1024];
                        while let Some(path) = jobs.get(next.fetch_add(1, Ordering::Relaxed)) {
                            let result = self
                                .parent(path)
                                .and_then(|(dir, name)| open_checked(&dir, &name, false))
                                .and_then(|file| {
                                    hash_buffered(file, &mut buffer, |bytes| {
                                        let _ = sender.send(HashEvent::Bytes(path.clone(), bytes));
                                    })
                                });
                            if sender
                                .send(HashEvent::Finished(path.clone(), result))
                                .is_err()
                            {
                                return;
                            }
                        }
                    }));
                }
                drop(sender);
                for event in receiver {
                    match event {
                        HashEvent::Bytes(path, bytes) => {
                            progress.current_path = path;
                            progress.bytes_hashed = progress.bytes_hashed.saturating_add(bytes);
                        }
                        HashEvent::Finished(path, result) => {
                            progress.current_path = path.clone();
                            match result {
                                Ok(entry) => {
                                    progress.files_hashed += 1;
                                    out.entries.insert(path, entry);
                                }
                                Err(error) => push_scan_issue(&mut out, format!("{path}：{error}")),
                            }
                        }
                    }
                    report(&progress);
                }
                for handle in handles {
                    if handle.join().is_err() {
                        push_scan_issue(&mut out, "文件校验线程异常，检查未完成".into());
                    }
                }
            });
        }
        progress.phase = ScanPhase::Complete;
        progress.current_path.clear();
        report(&progress);
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

enum HashEvent {
    Bytes(String, u64),
    Finished(String, Result<Entry>),
}

fn hash_buffered(
    mut file: impl Read,
    buffer: &mut [u8],
    mut report: impl FnMut(u64),
) -> Result<Entry> {
    let mut sha = Sha256::new();
    let mut bytes = 0u64;
    let mut pending = 0u64;
    let mut reported = Instant::now();
    loop {
        let count = match file.read(buffer) {
            Ok(count) => count,
            Err(error) => {
                if pending > 0 {
                    report(pending);
                }
                return Err(error.into());
            }
        };
        if count == 0 {
            break;
        }
        bytes = bytes
            .checked_add(count as u64)
            .context("文件大小超出限制")?;
        pending += count as u64;
        sha.update(&buffer[..count]);
        if reported.elapsed() >= Duration::from_millis(150) {
            report(pending);
            pending = 0;
            reported = Instant::now();
        }
    }
    if pending > 0 {
        report(pending);
    }
    Ok(Entry::File {
        sha256: hex::encode(sha.finalize()),
        bytes,
    })
}

fn push_scan_issue(out: &mut Manifest, issue: String) {
    if out.issues.len() < 200 {
        out.issues.push(issue);
    } else if out.issues.len() == 200 {
        out.issues
            .push("扫描错误过多，检查未完成；请修复错误后重试".into());
    }
}

fn collect_scan(
    root: &Root,
    out: &mut Manifest,
    progress: &mut ScanProgress,
    report: &mut impl FnMut(&ScanProgress),
) -> Vec<String> {
    let mut jobs = Vec::new();
    let mut directories = vec![(String::new(), 0usize)];
    while let Some((prefix, depth)) = directories.pop() {
        if out.issues.len() >= 200 {
            push_scan_issue(out, String::new());
            break;
        }
        if depth > 96 {
            push_scan_issue(out, format!("目录层级过深：{prefix}"));
            continue;
        }
        progress.current_path.clone_from(&prefix);
        report(progress);
        let dir = if prefix.is_empty() {
            root.dir.try_clone().map_err(Into::into)
        } else {
            root.parent(&prefix)
                .and_then(|(parent, name)| parent.open_dir_nofollow(name).map_err(Into::into))
        };
        let dir = match dir {
            Ok(dir) => dir,
            Err(error) => {
                push_scan_issue(out, format!("无法读取目录 {prefix}：{error}"));
                continue;
            }
        };
        let entries = match dir.entries() {
            Ok(entries) => entries,
            Err(error) => {
                push_scan_issue(out, format!("无法读取目录 {prefix}：{error}"));
                continue;
            }
        };
        for item in entries {
            if out.issues.len() >= 200 {
                push_scan_issue(out, String::new());
                return jobs;
            }
            let item = match item {
                Ok(item) => item,
                Err(error) => {
                    push_scan_issue(out, error.to_string());
                    continue;
                }
            };
            let name = item.file_name();
            let Some(name) = name.to_str() else {
                push_scan_issue(out, "发现非 Unicode 文件名".into());
                continue;
            };
            if ignored(name) {
                out.ignored += 1;
                continue;
            }
            if out.entries.len() + jobs.len() >= LIMIT {
                push_scan_issue(
                    out,
                    format!("扫描超过 {LIMIT} 个文件和目录的当前上限，请拆分同步任务"),
                );
                return jobs;
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
                    push_scan_issue(out, format!("{path}：{error}"));
                    continue;
                }
            };
            if reparse(&metadata) || metadata.file_type().is_symlink() {
                push_scan_issue(out, format!("不是普通文件或目录：{path}"));
                continue;
            }
            if metadata.is_dir() {
                out.entries.insert(path.clone(), Entry::Directory);
                directories.push((path, depth + 1));
                progress.directories += 1;
            } else if metadata.is_file() {
                jobs.push(path);
                progress.files_total += 1;
            } else {
                push_scan_issue(out, format!("不是普通文件：{path}"));
            }
            report(progress);
        }
        // `entries` and `dir` close here before the next directory is opened.
    }
    jobs
}

#[cfg(test)]
mod scan_progress_tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn slow_file_reports_bytes_before_eof() -> Result<()> {
        struct SlowRead<'a> {
            blocks: usize,
            first: bool,
            eof: &'a Cell<bool>,
        }
        impl Read for SlowRead<'_> {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if self.blocks == 0 {
                    self.eof.set(true);
                    return Ok(0);
                }
                if self.first {
                    self.first = false;
                    std::thread::sleep(Duration::from_millis(170));
                }
                self.blocks -= 1;
                buffer[..4].copy_from_slice(b"data");
                Ok(4)
            }
        }
        let eof = Cell::new(false);
        let mut reports = Vec::new();
        let result = hash_buffered(
            SlowRead {
                blocks: 3,
                first: true,
                eof: &eof,
            },
            &mut [0; 8],
            |bytes| reports.push((bytes, eof.get())),
        )?;
        assert!(
            reports
                .iter()
                .any(|(bytes, after_eof)| *bytes > 0 && !after_eof)
        );
        assert_eq!(reports.iter().map(|(bytes, _)| bytes).sum::<u64>(), 12);
        assert_eq!(result, hash_file(&b"datadatadata"[..])?);
        Ok(())
    }
}
