use anyhow::Result;
use std::fs;
use syncfu_core::{
    files::{Root, hash_file},
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
fn scan_limit_remains_global_across_workers() -> Result<()> {
    let temp = tempfile::tempdir()?;
    for i in 0..syncfu_core::files::LIMIT + 1 {
        fs::write(temp.path().join(format!("f-{i}")), b"")?;
    }
    let result = Root::open(&temp.path().canonicalize()?)?.scan_with_workers(4);
    assert!(result.entries.len() <= syncfu_core::files::LIMIT);
    assert!(!result.issues.is_empty());
    Ok(())
}
