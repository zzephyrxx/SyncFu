use anyhow::Result;
use std::fs;
use syncfu_core::{
    files::{Root, SCAN_BATCH_SIZE, ScanPhase, hash_file},
    model::Entry,
};
#[test]
fn parallel_scan_matches_exact_hashes_and_single_worker() -> Result<()> {
    let temp = tempfile::tempdir()?;
    fs::create_dir_all(temp.path().join("a/b"))?;
    for i in 0..180 {
        let path = temp.path().join(format!("a/b/file-{i}.txt"));
        fs::write(path, vec![i as u8; i * 97])?;
    }
    fs::write(temp.path().join("中文 文件.md"), "真实内容\n")?;
    fs::create_dir(temp.path().join("empty"))?;
    let root = Root::open(&temp.path().canonicalize()?)?;
    let one = root.scan_with_workers(1);
    let four = root.scan_with_workers(4);
    assert!(one.issues.is_empty());
    assert!(four.issues.is_empty());
    assert_eq!(one.entries, four.entries);
    for (path, entry) in &four.entries {
        if matches!(entry, Entry::File { .. }) {
            assert_eq!(*entry, hash_file(fs::File::open(temp.path().join(path))?)?);
        }
    }
    fs::write(temp.path().join("a/b/file-100.txt"), vec![255u8; 9700])?;
    let changed = root.scan();
    assert_ne!(
        changed.entries.get("a/b/file-100.txt"),
        four.entries.get("a/b/file-100.txt")
    );
    Ok(())
}
#[cfg(unix)]
#[test]
fn parallel_scan_does_not_follow_links_or_hide_invalid_names() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let outside = tempfile::tempdir()?;
    fs::write(outside.path().join("secret"), b"outside")?;
    std::os::unix::fs::symlink(outside.path(), temp.path().join("alias"))?;
    fs::write(temp.path().join("CON.txt"), b"invalid")?;
    let result = Root::open(&temp.path().canonicalize()?)?.scan();
    assert!(!result.issues.is_empty());
    assert!(!result.entries.contains_key("alias/secret"));
    assert!(!result.entries.contains_key("CON.txt"));
    Ok(())
}
#[test]
fn scan_more_than_twenty_thousand_files_in_bounded_batches() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let count = 20_513usize;
    for i in 0..count {
        fs::write(temp.path().join(format!("f-{i:05}")), i.to_le_bytes())?;
    }
    let mut max_queued = 0;
    let mut batches = 0;
    let mut hashed_before_discovery_finished = false;
    let mut last = None;
    let result = Root::open(&temp.path().canonicalize()?)?.scan_with_progress(|progress| {
        max_queued = max_queued.max(progress.queued_files);
        if progress.phase == ScanPhase::Hashing && progress.current_path.is_empty() {
            batches += 1;
        }
        hashed_before_discovery_finished |= !progress.discovery_complete
            && progress.files_hashed > 0
            && progress.files_total < count as u64;
        if let Some(previous) = &last {
            let previous: &syncfu_core::files::ScanProgress = previous;
            assert!(progress.files_total >= previous.files_total);
            assert!(progress.files_hashed >= previous.files_hashed);
            assert!(progress.bytes_hashed >= previous.bytes_hashed);
        }
        last = Some(progress.clone());
    });
    assert!(result.issues.is_empty(), "{:?}", result.issues);
    assert_eq!(result.entries.len(), count);
    assert_eq!(max_queued, SCAN_BATCH_SIZE as u64);
    assert_eq!(batches, count.div_ceil(SCAN_BATCH_SIZE));
    assert!(hashed_before_discovery_finished);
    let last = last.unwrap();
    assert_eq!(last.phase, ScanPhase::Complete);
    assert!(last.discovery_complete);
    assert_eq!(last.queued_files, 0);
    assert_eq!(last.files_total, count as u64);
    assert_eq!(last.files_hashed, count as u64);
    assert_eq!(last.bytes_hashed, (count * size_of::<usize>()) as u64);
    // Check content identities across every chunk boundary, not just counts.
    for i in 0..count {
        assert_eq!(
            result.entries.get(&format!("f-{i:05}")),
            Some(&hash_file(i.to_le_bytes().as_slice())?)
        );
    }
    Ok(())
}

#[test]
fn scan_batches_cross_directories_without_losing_or_duplicating_entries() -> Result<()> {
    let temp = tempfile::tempdir()?;
    for folder in 0..5 {
        fs::create_dir(temp.path().join(format!("folder-{folder}")))?;
    }
    let count = SCAN_BATCH_SIZE * 3 + 17;
    for index in 0..count {
        fs::write(
            temp.path()
                .join(format!("folder-{}/item-{index}", index % 5)),
            b"contents",
        )?;
    }
    let root = Root::open(&temp.path().canonicalize()?)?;
    let one = root.scan_with_workers(1);
    let four = root.scan_with_workers(4);
    assert!(one.issues.is_empty());
    assert!(four.issues.is_empty());
    assert_eq!(one.entries, four.entries);
    assert_eq!(four.entries.len(), count + 5);
    for index in 0..count {
        assert_eq!(
            four.entries
                .get(&format!("folder-{}/item-{index}", index % 5)),
            Some(&hash_file(b"contents".as_slice())?)
        );
    }
    Ok(())
}

#[test]
fn final_scan_batch_handles_empty_exact_and_partial_boundaries() -> Result<()> {
    for count in [
        0,
        1,
        SCAN_BATCH_SIZE - 1,
        SCAN_BATCH_SIZE,
        SCAN_BATCH_SIZE + 1,
        SCAN_BATCH_SIZE * 2,
    ] {
        let temp = tempfile::tempdir()?;
        for index in 0..count {
            fs::write(temp.path().join(format!("entry-{index}")), b"x")?;
        }
        let mut last = None;
        let manifest = Root::open(&temp.path().canonicalize()?)?.scan_with_progress(|progress| {
            assert!(progress.queued_files <= SCAN_BATCH_SIZE as u64);
            last = Some(progress.clone());
        });
        assert!(manifest.issues.is_empty());
        assert_eq!(manifest.entries.len(), count);
        let last = last.unwrap();
        assert_eq!(last.phase, ScanPhase::Complete);
        assert!(last.discovery_complete);
        assert_eq!(last.queued_files, 0);
        assert_eq!(last.files_hashed, count as u64);
        assert_eq!(last.files_total, count as u64);
        assert_eq!(last.bytes_hashed, count as u64);
    }
    Ok(())
}

/// Run only this test under a low descriptor limit: changing a process-wide
/// limit inside the parallel test harness would make unrelated tests flaky.
#[cfg(unix)]
#[test]
fn scan_many_directories_with_low_descriptor_limit() -> Result<()> {
    if std::env::var_os("SYNCFU_SCAN_LOW_FD_CHILD").is_none() {
        let output = std::process::Command::new("sh")
            .args([
                "-c",
                "ulimit -n 64 && exec \"$1\" --exact scan_many_directories_with_low_descriptor_limit --nocapture",
                "syncfu-scan-low-fd",
            ])
            .arg(std::env::current_exe()?)
            .env("SYNCFU_SCAN_LOW_FD_CHILD", "1")
            .output()?;
        assert!(
            output.status.success(),
            "low-descriptor scan failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return Ok(());
    }
    let temp = tempfile::tempdir()?;
    // Every sibling contains a file, which used to keep its directory handle
    // alive until all discovery completed. Also exercise depth without keeping
    // every ancestor's ReadDir alive.
    for index in 0..320 {
        let directory = temp.path().join(format!("folder-{index}"));
        fs::create_dir(&directory)?;
        fs::write(directory.join("content.txt"), b"bounded handles")?;
    }
    let mut deep = temp.path().to_owned();
    for _ in 0..80 {
        deep.push("deep");
        fs::create_dir(&deep)?;
        fs::write(deep.join("content.txt"), b"bounded handles")?;
    }
    let root = Root::open(&temp.path().canonicalize()?)?;
    let manifest = root.scan_with_workers(4);
    assert!(manifest.issues.is_empty(), "{:?}", manifest.issues);
    assert_eq!(manifest.entries.len(), 800);
    assert_eq!(
        manifest
            .entries
            .values()
            .filter(|entry| matches!(entry, Entry::File { .. }))
            .count(),
        400
    );
    Ok(())
}

#[test]
fn scan_progress_reports_real_counts_and_completes_empty_directories() -> Result<()> {
    let temp = tempfile::tempdir()?;
    fs::create_dir_all(temp.path().join("nested/empty"))?;
    fs::write(temp.path().join("one"), b"12345")?;
    fs::write(temp.path().join("nested/two"), b"678")?;
    fs::write(temp.path().join("nested/three"), b"")?;
    fs::write(temp.path().join(".DS_Store"), b"ignored")?;
    let root = Root::open(&temp.path().canonicalize()?)?;
    let mut reports = Vec::new();
    let manifest = root.scan_with_progress(|progress| reports.push(progress.clone()));
    assert!(manifest.issues.is_empty());
    assert_eq!(manifest.ignored, 1);
    assert_eq!(reports.first().unwrap().phase, ScanPhase::Discovering);
    assert!(
        reports
            .iter()
            .any(|progress| progress.phase == ScanPhase::Hashing)
    );
    assert!(
        reports
            .iter()
            .any(|progress| progress.current_path == "nested")
    );
    for pair in reports.windows(2) {
        assert!(pair[0].files_total <= pair[1].files_total);
        assert!(pair[0].files_hashed <= pair[1].files_hashed);
        assert!(pair[0].bytes_hashed <= pair[1].bytes_hashed);
    }
    let last = reports.last().unwrap();
    assert_eq!(last.phase, ScanPhase::Complete);
    assert_eq!(last.directories, 2);
    assert_eq!(last.files_total, 3);
    assert_eq!(last.files_hashed, 3);
    assert_eq!(last.bytes_hashed, 8);
    assert!(last.current_path.is_empty());
    assert!(last.discovery_complete);
    assert_eq!(last.queued_files, 0);
    let empty = tempfile::tempdir()?;
    reports.clear();
    assert!(
        Root::open(&empty.path().canonicalize()?)?
            .scan_with_progress(|progress| reports.push(progress.clone()))
            .issues
            .is_empty()
    );
    assert_eq!(reports.last().unwrap().phase, ScanPhase::Complete);
    assert_eq!(reports.last().unwrap().files_hashed, 0);
    Ok(())
}

#[cfg(unix)]
#[test]
fn queued_scan_paths_do_not_follow_a_directory_replaced_by_a_symlink() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let outside = tempfile::tempdir()?;
    fs::create_dir(temp.path().join("nested"))?;
    fs::write(temp.path().join("nested/file.txt"), b"authorized")?;
    fs::write(outside.path().join("file.txt"), b"outside secret")?;
    let mut replaced = false;
    let root = Root::open(&temp.path().canonicalize()?)?;
    let manifest = root.scan_with_progress(|progress| {
        if progress.phase == ScanPhase::Hashing && !replaced {
            replaced = true;
            fs::rename(temp.path().join("nested"), temp.path().join("moved")).unwrap();
            std::os::unix::fs::symlink(outside.path(), temp.path().join("nested")).unwrap();
        }
    });
    assert!(replaced);
    assert!(!manifest.issues.is_empty());
    assert!(!manifest.entries.contains_key("nested/file.txt"));
    assert_eq!(
        fs::read(outside.path().join("file.txt"))?,
        b"outside secret"
    );
    Ok(())
}

#[cfg(unix)]
#[test]
fn scan_error_cap_does_not_claim_a_file_count_limit() -> Result<()> {
    let temp = tempfile::tempdir()?;
    for index in 0..205 {
        fs::write(
            temp.path().join(format!("CON.{index}")),
            b"invalid portable name",
        )?;
    }
    let manifest = Root::open(&temp.path().canonicalize()?)?.scan();
    assert_eq!(manifest.issues.len(), 201);
    assert!(manifest.issues.last().unwrap().contains("扫描错误过多"));
    assert!(
        !manifest
            .issues
            .iter()
            .any(|issue| issue.contains("条目上限") || issue.contains("20000"))
    );
    Ok(())
}
