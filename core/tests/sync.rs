use anyhow::{Context, Result};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};
use syncfu_core::policy::{Direction, TaskPolicy, Trust};
use syncfu_core::{
    engine::Engine,
    model::{Action, Batch, Plan, Task},
    node::Node,
    pairing::Identity,
};
use tempfile::TempDir;

struct Fixture {
    _temp: TempDir,
    a: Arc<Node>,
    b: Arc<Node>,
    left: PathBuf,
    right: PathBuf,
    task: Task,
}

impl Fixture {
    async fn new() -> Result<Self> {
        let temp = tempfile::tempdir()?;
        let left = temp.path().join("left");
        let right = temp.path().join("right");
        fs::create_dir(&left)?;
        fs::create_dir(&right)?;
        let addr = "127.0.0.1:0".parse()?;
        let a = Node::start(
            Engine::open(&temp.path().join("a-state"))?,
            Identity::generate()?,
            "A".into(),
            addr,
            false,
        )
        .await?;
        let b = Node::start(
            Engine::open(&temp.path().join("b-state"))?,
            Identity::generate()?,
            "B".into(),
            addr,
            false,
        )
        .await?;
        let ai = a.snapshot()?.device.id;
        let bi = b.snapshot()?.device.id;
        assert!(a.grant(&bi, &left).is_err());
        let address = format!("127.0.0.1:{}", b.snapshot()?.device.port);
        let code = b.invite()?.code;
        let pairing = tokio::spawn({
            let a = a.clone();
            async move { a.pair(&address, &code).await }
        });
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if let Some(request) = b.snapshot()?.pending.first() {
                    assert!(a.snapshot()?.peers.is_empty());
                    assert!(b.snapshot()?.peers.is_empty());
                    assert!(b.grant(&ai, &right).is_err());
                    assert_eq!(request.id, ai);
                    b.answer_pair(&request.id, true)?;
                    return Ok::<_, anyhow::Error>(());
                }
                if pairing.is_finished() {
                    anyhow::bail!("配对在批准前结束");
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await??;
        pairing.await??;
        assert!(a.folders(&bi).await?.remote.is_empty());
        let af = a.grant(&bi, &left)?;
        let bf = b.grant(&ai, &right)?;
        let task = a.create_task(&bi, &af.id, &bf.id).await?;
        Ok(Self {
            _temp: temp,
            a,
            b,
            left,
            right,
            task,
        })
    }
    async fn inspect(&self) -> Result<Plan> {
        self.a.inspect(&self.task.id).await
    }
    async fn apply(&self, plan: Plan, accept_delete: bool) -> Result<Batch> {
        let selected = plan
            .comparison
            .changes
            .iter()
            .filter(|c| {
                c.action != Action::Conflict && (accept_delete || c.action != Action::Delete)
            })
            .map(|c| c.path.clone())
            .collect();
        self.a.execute(&plan.id, &plan.digest, selected).await
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn authenticated_bidirectional_sync_and_undo() -> Result<()> {
    let f = Fixture::new().await?;
    fs::create_dir(f.left.join("中文资料"))?;
    fs::write(f.left.join("中文资料/笔记.md"), b"from A")?;
    fs::write(f.left.join("empty.txt"), b"")?;
    fs::create_dir(f.right.join("empty"))?;
    fs::write(f.right.join("from-b.bin"), vec![127; 750_000])?;
    fs::write(f.left.join("conflict.md"), "a")?;
    fs::write(f.right.join("conflict.md"), "b")?;

    let plan = f.inspect().await?;
    assert_eq!(plan.comparison.total, 4);
    assert!(
        plan.comparison.issues.is_empty(),
        "{:?}",
        plan.comparison.issues
    );
    assert_eq!(
        plan.comparison
            .changes
            .iter()
            .filter(|c| c.action == Action::Conflict)
            .count(),
        1
    );
    let batch = f.apply(plan, false).await?;
    assert_eq!(batch.status, "completed", "{batch:?}");
    assert_eq!(batch.done, 5);
    assert_eq!(fs::read(f.right.join("中文资料/笔记.md"))?, b"from A");
    assert!(fs::read(f.right.join("empty.txt"))?.is_empty());
    assert_eq!(fs::metadata(f.left.join("from-b.bin"))?.len(), 750_000);
    assert!(f.left.join("empty").is_dir());
    assert_eq!(fs::read(f.left.join("conflict.md"))?, b"a");

    let undo = f.b.inspect_undo(&batch.id).await?;
    let selected = undo
        .comparison
        .changes
        .iter()
        .filter(|c| c.action != Action::Conflict)
        .map(|c| c.path.clone())
        .collect();
    let result = f.b.execute(&undo.id, &undo.digest, selected).await?;
    assert_eq!(result.status, "completed", "{result:?}");
    assert!(!f.right.join("中文资料").exists());
    assert!(!f.right.join("empty.txt").exists());
    assert!(!f.left.join("empty").exists());
    assert!(!f.left.join("from-b.bin").exists());
    assert_eq!(fs::read(f.left.join("中文资料/笔记.md"))?, b"from A");
    assert_eq!(
        f.inspect()
            .await?
            .comparison
            .changes
            .iter()
            .find(|c| c.path == "from-b.bin")
            .context("未找到独有文件")?
            .action,
        Action::Create
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn preserves_skipped_deletions_and_rejects_stale_plan() -> Result<()> {
    let f = Fixture::new().await?;
    fs::write(f.left.join("notes.md"), "identical")?;
    fs::write(f.right.join("notes.md"), "identical")?;
    assert!(f.inspect().await?.comparison.changes.is_empty());
    fs::remove_file(f.left.join("notes.md"))?;
    fs::write(f.left.join("other.md"), "v1")?;
    let plan = f.inspect().await?;
    let change = plan
        .comparison
        .changes
        .iter()
        .find(|c| c.path == "notes.md")
        .context("缺少删除操作")?;
    assert_eq!(change.action, Action::Delete);
    let completed = f.apply(plan, false).await?;
    assert_eq!(completed.status, "completed", "{completed:?}");
    assert!(!f.left.join("notes.md").exists());
    assert_eq!(fs::read(f.right.join("notes.md"))?, b"identical");
    let plan = f.inspect().await?;
    assert_eq!(plan.comparison.changes[0].action, Action::Delete);
    fs::write(f.right.join("notes.md"), "edited after preview")?;
    let result = f.apply(plan, true).await;
    assert!(result.as_ref().is_err() || result.as_ref().is_ok_and(|b| b.done == 0));
    assert_eq!(fs::read(f.right.join("notes.md"))?, b"edited after preview");
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn undo_restores_backup_but_keeps_later_edits() -> Result<()> {
    let f = Fixture::new().await?;
    for name in ["restore.txt", "protect.txt"] {
        fs::write(f.left.join(name), "before")?;
        fs::write(f.right.join(name), "before")?;
    }
    assert!(f.inspect().await?.comparison.changes.is_empty());
    for name in ["restore.txt", "protect.txt"] {
        fs::write(f.left.join(name), "after")?;
    }
    let result = f.apply(f.inspect().await?, false).await?;
    assert_eq!(result.status, "completed", "{result:?}");
    fs::write(f.right.join("protect.txt"), "later")?;
    let undo = f.a.inspect_undo(&result.id).await?;
    assert_eq!(
        undo.comparison
            .changes
            .iter()
            .find(|c| c.path == "protect.txt")
            .context("缺少保护项")?
            .action,
        Action::Conflict
    );
    let result = f.apply(undo, true).await?;
    assert_eq!(result.done, 1);
    assert_eq!(fs::read(f.right.join("restore.txt"))?, b"before");
    assert_eq!(fs::read(f.right.join("protect.txt"))?, b"later");
    Ok(())
}

#[test]
fn windows_names_and_traversal_are_denied() {
    for path in [
        "../outside",
        "/absolute",
        "a//b",
        "CON.md",
        "COM1.txt",
        "a\\b",
        "title.",
        "x/.syncfu-stage/foo",
        "C:foo",
    ] {
        assert!(syncfu_core::files::validate_path(path).is_err(), "{path}");
    }
    assert!(syncfu_core::files::validate_path("资料/会议笔记.md").is_ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn replacing_the_granted_directory_requires_authorization_again() -> Result<()> {
    let f = Fixture::new().await?;
    fs::write(f.left.join("notes.md"), "keep")?;
    let away = f._temp.path().join("old-left");
    fs::rename(&f.left, &away)?;
    fs::create_dir(&f.left)?;
    assert!(f.inspect().await.is_err());
    assert_eq!(fs::read(away.join("notes.md"))?, b"keep");
    Ok(())
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn replacement_with_link_cannot_write_outside_authorized_root() -> Result<()> {
    let f = Fixture::new().await?;
    fs::create_dir(f.left.join("files"))?;
    fs::create_dir(f.right.join("files"))?;
    fs::write(f.left.join("files/new.md"), "test")?;
    let plan = f.inspect().await?;
    let outside = f._temp.path().join("outside");
    fs::create_dir(&outside)?;
    fs::remove_dir(f.right.join("files"))?;
    std::os::unix::fs::symlink(&outside, f.right.join("files"))?;
    let result = f.apply(plan, false).await;
    assert!(result.as_ref().is_err() || result.as_ref().is_ok_and(|batch| batch.done == 0));
    assert!(!outside.join("new.md").exists());
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "runs the 10,000-file performance fixture"]
async fn many_small_files() -> Result<()> {
    let f = Fixture::new().await?;
    for idx in 0..100 {
        fs::create_dir(f.left.join(format!("group-{idx:03}")))?;
        fs::create_dir(f.right.join(format!("group-{idx:03}")))?;
        for file in 0..100 {
            let path = format!("group-{idx:03}/file-{file:03}.md");
            let content = vec![(idx + file) as u8; 1024];
            fs::write(f.left.join(&path), &content)?;
            fs::write(f.right.join(&path), &content)?;
        }
    }
    for root in [&f.left, &f.right] {
        fs::write(root.join("large.bin"), vec![1; 8 * 1024 * 1024])?;
    }
    let start = std::time::Instant::now();
    let plan = f.inspect().await?;
    let first = start.elapsed();
    assert!(plan.comparison.changes.is_empty());
    assert_eq!(plan.comparison.same, 10_001);

    let start = std::time::Instant::now();
    assert!(f.inspect().await?.comparison.changes.is_empty());
    let unchanged = start.elapsed();

    for idx in 0..100 {
        fs::write(
            f.left.join(format!("group-{idx:03}/file-000.md")),
            b"changed",
        )?;
    }
    let start = std::time::Instant::now();
    let plan = f.inspect().await?;
    let changed = start.elapsed();
    assert_eq!(plan.comparison.changes.len(), 100);
    let start = std::time::Instant::now();
    let batch = f.apply(plan, false).await?;
    assert_eq!(batch.status, "completed", "{batch:?}");
    assert_eq!(batch.done, 100);
    eprintln!(
        "10001 files, first scan {first:?}, unchanged {unchanged:?}, 1% changes scan {changed:?}, selected sync {:?}",
        start.elapsed()
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn simultaneous_approval_writes_only_one_batch() -> Result<()> {
    let f = Fixture::new().await?;
    fs::write(f.left.join("notes.md"), b"content")?;
    let a = f.a.inspect(&f.task.id).await?;
    let b = f.b.inspect(&f.task.id).await?;
    let (a, b) = tokio::join!(
        f.a.execute(&a.id, &a.digest, vec!["notes.md".into()]),
        f.b.execute(&b.id, &b.digest, vec!["notes.md".into()])
    );
    assert_eq!(
        [a.as_ref(), b.as_ref()]
            .into_iter()
            .filter(|r| r.is_ok_and(|batch| batch.done == 1))
            .count(),
        1,
        "a={a:?}, b={b:?}"
    );
    assert_eq!(fs::read(f.right.join("notes.md"))?, b"content");
    assert!(
        f.a.snapshot()?
            .history
            .iter()
            .all(|b| b.status != "pending")
    );
    assert!(
        f.b.snapshot()?
            .history
            .iter()
            .all(|b| b.status != "pending")
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn quota_exhaustion_leaves_destination_intact() -> Result<()> {
    let f = Fixture::new().await?;
    f.b.engine.set_settings(30, 1_000_000, None)?;
    let original = vec![42; 1_000_001];
    for root in [&f.left, &f.right] {
        fs::write(root.join("notes.md"), &original)?;
    }
    assert!(f.inspect().await?.comparison.changes.is_empty());
    fs::write(f.left.join("notes.md"), b"updated")?;
    let batch = f.apply(f.inspect().await?, false).await?;
    assert_eq!(batch.done, 0, "{batch:?}");
    assert_eq!(batch.status, "failed");
    assert_eq!(fs::read(f.right.join("notes.md"))?, original);
    Ok(())
}

async fn set_policy(f: &Fixture, direction: Direction, trust: Trust) -> Result<TaskPolicy> {
    let current = f.a.engine.policy_state(&f.task.id)?.current;
    let mut next = current.clone();
    next.revision += 1;
    next.direction = direction;
    next.trust = trust;
    f.a.propose_policy(&f.task.id, current.revision, next)
        .await?;
    if let Some(pending) = f.b.engine.policy_state(&f.task.id)?.pending {
        f.b.answer_policy(&f.task.id, &pending.proposal.id, true)
            .await?;
    }
    let a = f.a.engine.policy_state(&f.task.id)?;
    let b = f.b.engine.policy_state(&f.task.id)?;
    anyhow::ensure!(
        a.pending.is_none() && b.pending.is_none() && a.current == b.current,
        "策略未一致"
    );
    Ok(a.current)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_first_consent_stale_plan_and_receiver_pull() -> Result<()> {
    let f = Fixture::new().await?;
    fs::write(f.left.join("shared.txt"), b"source-v1")?;
    fs::write(f.right.join("shared.txt"), b"local-edit")?;
    fs::write(f.right.join("extra.txt"), b"keep")?;
    let old_plan = f.inspect().await?;
    let mut next = f.a.engine.policy_state(&f.task.id)?.current;
    assert_eq!(next.trust, Trust::Unclassified);
    assert_eq!(next.trigger, syncfu_core::policy::Trigger::Manual);
    next.revision = 1;
    next.trust = Trust::Personal;
    next.direction = Direction::OneWayUpdate {
        source_device: f.a.device().id,
    };
    f.a.propose_policy(&f.task.id, 0, next).await?;
    let pending =
        f.b.engine
            .policy_state(&f.task.id)?
            .pending
            .context("缺少待确认提案")?;
    assert!(!pending.accepted);
    assert!(f.a.inspect(&f.task.id).await.is_err());
    f.b.answer_policy(&f.task.id, &pending.proposal.id, true)
        .await?;
    assert!(
        f.a.execute(&old_plan.id, &old_plan.digest, vec!["extra.txt".into()])
            .await
            .is_err()
    );
    assert!(!f.left.join("extra.txt").exists());
    let plan = f.b.inspect(&f.task.id).await?;
    assert_eq!(plan.comparison.changes.len(), 1);
    assert_eq!(plan.comparison.changes[0].target, 0);
    let batch =
        f.b.execute(&plan.id, &plan.digest, vec!["shared.txt".into()])
            .await?;
    assert_eq!(batch.done, 1);
    assert_eq!(fs::read(f.right.join("shared.txt"))?, b"source-v1");
    assert_eq!(fs::read(f.right.join("extra.txt"))?, b"keep");
    fs::remove_file(f.left.join("shared.txt"))?;
    assert!(f.inspect().await?.comparison.changes.is_empty());
    assert!(f.right.join("shared.txt").exists());
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_mirror_full_plan_risk_approval_and_backup_undo() -> Result<()> {
    let f = Fixture::new().await?;
    fs::write(f.left.join("keep.txt"), b"keep")?;
    fs::write(f.right.join("keep.txt"), b"keep")?;
    for i in 0..103 {
        fs::write(
            f.right.join(format!("extra-{i}.txt")),
            b"saved-before-delete",
        )?;
    }
    set_policy(
        &f,
        Direction::OneWayMirror {
            source_device: f.a.device().id,
        },
        Trust::Personal,
    )
    .await?;
    let plan = f.inspect().await?;
    let paths = plan
        .comparison
        .changes
        .iter()
        .map(|c| c.path.clone())
        .collect::<Vec<_>>();
    let risk =
        f.a.preview_execution(&plan.id, &plan.digest, paths[..9].to_vec())
            .await?;
    assert!(risk.approval_required);
    assert!(
        risk.risks
            .iter()
            .any(|r| r.planned_deletions == 103 && r.selected_deletions == 9)
    );
    assert!(
        f.a.execute(&plan.id, &plan.digest, paths[..9].to_vec())
            .await
            .is_err()
    );
    assert!(f.a.engine.active()?.is_none());
    assert!(f.b.engine.active()?.is_none());
    assert!(f.right.join("extra-0.txt").exists());
    let batch =
        f.a.execute_reviewed(&plan.id, &plan.digest, paths, true)
            .await?;
    assert_eq!(batch.status, "completed", "{batch:?}");
    assert_eq!(batch.done, 103);
    assert!(!f.right.join("extra-0.txt").exists());
    let undo = f.a.inspect_undo(&batch.id).await?;
    let paths = undo
        .comparison
        .changes
        .iter()
        .filter(|c| c.action != Action::Conflict)
        .map(|c| c.path.clone())
        .collect();
    let restored = f.a.execute(&undo.id, &undo.digest, paths).await?;
    assert_eq!(restored.done, 103);
    assert_eq!(
        fs::read(f.right.join("extra-0.txt"))?,
        b"saved-before-delete"
    );
    assert_eq!(fs::read(f.left.join("keep.txt"))?, b"keep");
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_source_suddenly_empty_requires_explicit_manager_approval() -> Result<()> {
    let f = Fixture::new().await?;
    set_policy(&f, Direction::Bidirectional, Trust::Personal).await?;
    fs::write(f.left.join("only.txt"), b"important")?;
    fs::write(f.right.join("only.txt"), b"important")?;
    assert!(f.inspect().await?.comparison.changes.is_empty());
    fs::remove_file(f.left.join("only.txt"))?;
    let plan = f.inspect().await?;
    let paths = vec!["only.txt".into()];
    let risk =
        f.a.preview_execution(&plan.id, &plan.digest, paths.clone())
            .await?;
    assert!(risk.risks.iter().any(|r| {
        r.reasons
            .contains(&syncfu_core::risk::RiskReason::SourceEmpty)
    }));
    assert!(
        f.a.execute(&plan.id, &plan.digest, paths.clone())
            .await
            .is_err()
    );
    assert!(f.right.join("only.txt").exists());
    assert_eq!(
        f.a.execute_reviewed(&plan.id, &plan.digest, paths, true)
            .await?
            .done,
        1
    );
    assert!(!f.right.join("only.txt").exists());
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_shared_receiver_cannot_manage_but_can_pull() -> Result<()> {
    let f = Fixture::new().await?;
    set_policy(
        &f,
        Direction::OneWayUpdate {
            source_device: f.a.device().id,
        },
        Trust::Shared {
            owner_device: f.a.device().id,
        },
    )
    .await?;
    let mut next = f.b.engine.policy_state(&f.task.id)?.current;
    let revision = next.revision;
    next.revision += 1;
    next.direction = Direction::Bidirectional;
    assert!(
        f.b.propose_policy(&f.task.id, revision, next)
            .await
            .is_err()
    );
    fs::write(f.left.join("file.txt"), b"source")?;
    let plan = f.b.inspect(&f.task.id).await?;
    assert_eq!(
        f.b.execute(&plan.id, &plan.digest, vec!["file.txt".into()])
            .await?
            .done,
        1
    );
    assert_eq!(fs::read(f.right.join("file.txt"))?, b"source");
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_receiver_task_and_global_pause_block_remote_execution() -> Result<()> {
    let f = Fixture::new().await?;
    fs::write(f.left.join("file.txt"), b"source")?;
    f.b.pause_task(&f.task.id, true)?;
    let plan = f.inspect().await?;
    assert!(
        f.a.execute(&plan.id, &plan.digest, vec!["file.txt".into()])
            .await
            .is_err()
    );
    assert!(!f.right.join("file.txt").exists());
    assert!(f.a.engine.active()?.is_none());
    f.b.pause_task(&f.task.id, false)?;
    assert_eq!(f.apply(plan, false).await?.done, 1);
    f.b.pause_all(true)?;
    fs::write(f.left.join("second.txt"), b"next")?;
    assert!(f.b.snapshot()?.paused_all);
    let plan = f.inspect().await?;
    assert!(
        f.a.execute(&plan.id, &plan.digest, vec!["second.txt".into()])
            .await
            .is_err()
    );
    assert!(!f.right.join("second.txt").exists());
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_rejected_first_proposal_leaves_both_sides_unclassified() -> Result<()> {
    let f = Fixture::new().await?;
    let mut next = f.a.engine.policy_state(&f.task.id)?.current;
    next.revision = 1;
    next.trust = Trust::Personal;
    f.a.propose_policy(&f.task.id, 0, next).await?;
    let id =
        f.b.engine
            .policy_state(&f.task.id)?
            .pending
            .context("提案缺失")?
            .proposal
            .id;
    f.b.answer_policy(&f.task.id, &id, false).await?;
    for node in [&f.a, &f.b] {
        let state = node.engine.policy_state(&f.task.id)?;
        assert_eq!(state.current.trust, Trust::Unclassified);
        assert!(state.pending.is_none());
    }
    assert!(f.a.reconcile_policy(&f.task.id).await?.pending.is_none());
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_concurrent_personal_edits_reserve_one_version_without_deadlock() -> Result<()> {
    let f = Fixture::new().await?;
    let current = set_policy(&f, Direction::Bidirectional, Trust::Personal).await?;
    let mut a = current.clone();
    a.revision += 1;
    a.direction = Direction::OneWayUpdate {
        source_device: f.a.device().id,
    };
    let mut b = current.clone();
    b.revision += 1;
    b.direction = Direction::OneWayMirror {
        source_device: f.b.device().id,
    };
    let (a_result, b_result) = tokio::join!(
        f.a.propose_policy(&f.task.id, current.revision, a),
        f.b.propose_policy(&f.task.id, current.revision, b)
    );
    assert!(a_result.is_ok() || b_result.is_ok());
    f.a.reconcile_policy(&f.task.id).await?;
    f.b.reconcile_policy(&f.task.id).await?;
    let a = f.a.engine.policy_state(&f.task.id)?;
    let b = f.b.engine.policy_state(&f.task.id)?;
    assert_eq!(a.current, b.current);
    assert_eq!(a.current.revision, current.revision + 1);
    assert!(a.pending.is_none() && b.pending.is_none());
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p2_conflict_preview_resolution_and_protected_undo() -> Result<()> {
    use syncfu_core::conflicts::{Decision, DecisionRequest};
    let f = Fixture::new().await?;
    set_policy(&f, Direction::Bidirectional, Trust::Personal).await?;
    fs::write(f.left.join("conflict.md"), "left text\n")?;
    fs::write(f.right.join("conflict.md"), "right text\n")?;
    let plan = f.inspect().await?;
    let preview =
        f.a.preview_conflict(&plan.id, &plan.digest, "conflict.md")
            .await?;
    assert_eq!(preview.versions[0].text.as_deref(), Some("left text\n"));
    assert_eq!(preview.versions[1].text.as_deref(), Some("right text\n"));
    assert!(
        f.a.execute(&plan.id, &plan.digest, vec!["conflict.md".into()])
            .await
            .is_err()
    );
    let next =
        f.a.resolve_plan(
            &plan.id,
            &plan.digest,
            vec![DecisionRequest {
                path: "conflict.md".into(),
                decision: Decision::Use {
                    source_device: f.a.device().id,
                },
            }],
        )
        .await?;
    assert_ne!(plan.digest, next.digest);
    assert_eq!(next.resolutions.len(), 1);
    assert!(
        f.a.execute(&plan.id, &plan.digest, vec!["conflict.md".into()])
            .await
            .is_err()
    );
    let batch = f.apply(next, false).await?;
    assert_eq!(batch.done, 1);
    assert_eq!(
        fs::read_to_string(f.right.join("conflict.md"))?,
        "left text\n"
    );
    let undo = f.a.inspect_undo(&batch.id).await?;
    let result = f.apply(undo, false).await?;
    assert_eq!(result.done, 1);
    assert_eq!(
        fs::read_to_string(f.right.join("conflict.md"))?,
        "right text\n"
    );
    Ok(())
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p2_skip_version_reappears_after_edit_and_never_advances_baseline() -> Result<()> {
    use syncfu_core::conflicts::{Decision, DecisionRequest};
    let f = Fixture::new().await?;
    fs::write(f.left.join("same-path"), b"a")?;
    fs::write(f.right.join("same-path"), b"b")?;
    let plan = f.inspect().await?;
    let next =
        f.a.resolve_plan(
            &plan.id,
            &plan.digest,
            vec![DecisionRequest {
                path: "same-path".into(),
                decision: Decision::IgnoreVersion,
            }],
        )
        .await?;
    assert!(next.comparison.changes.is_empty());
    assert_eq!(f.a.engine.review_notes(&f.task.id)?.len(), 1);
    assert!(f.inspect().await?.comparison.changes.is_empty());
    assert!(f.a.engine.pair_state(&f.task.id)?.base.is_empty());
    fs::write(f.right.join("same-path"), b"changed")?;
    let plan = f.inspect().await?;
    assert_eq!(plan.comparison.changes.len(), 1);
    assert!(plan.review_notes.is_empty());
    f.a.resolve_plan(
        &plan.id,
        &plan.digest,
        vec![DecisionRequest {
            path: "same-path".into(),
            decision: Decision::Later,
        }],
    )
    .await?;
    let plan = f.inspect().await?;
    assert_eq!(plan.comparison.changes.len(), 1);
    assert!(!plan.review_notes[0].ignored);
    f.a.clear_review_note(&f.task.id, "same-path")?;
    assert!(f.a.engine.review_notes(&f.task.id)?.is_empty());
    Ok(())
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p2_stale_content_shared_receiver_and_structure_cannot_force_resolution() -> Result<()> {
    use syncfu_core::conflicts::{Decision, DecisionRequest};
    let f = Fixture::new().await?;
    set_policy(
        &f,
        Direction::Bidirectional,
        Trust::Shared {
            owner_device: f.a.device().id,
        },
    )
    .await?;
    fs::write(f.left.join("file"), b"a")?;
    fs::write(f.right.join("file"), b"b")?;
    let plan = f.b.inspect(&f.task.id).await?;
    assert!(
        f.b.resolve_plan(
            &plan.id,
            &plan.digest,
            vec![DecisionRequest {
                path: "file".into(),
                decision: Decision::Use {
                    source_device: f.b.device().id
                }
            }]
        )
        .await
        .is_err()
    );
    let plan = f.inspect().await?;
    fs::write(f.right.join("file"), b"edited")?;
    assert!(
        f.a.resolve_plan(
            &plan.id,
            &plan.digest,
            vec![DecisionRequest {
                path: "file".into(),
                decision: Decision::Use {
                    source_device: f.a.device().id
                }
            }]
        )
        .await
        .is_err()
    );
    fs::remove_file(f.right.join("file"))?;
    fs::create_dir(f.right.join("file"))?;
    let plan = f.inspect().await?;
    assert!(!plan.conflicts[0].resolvable);
    assert!(
        f.a.resolve_plan(
            &plan.id,
            &plan.digest,
            vec![DecisionRequest {
                path: "file".into(),
                decision: Decision::Use {
                    source_device: f.a.device().id
                }
            }]
        )
        .await
        .is_err()
    );
    Ok(())
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p2_preview_binary_size_limit_and_traversal() -> Result<()> {
    let f = Fixture::new().await?;
    for (name, a, b) in [
        ("binary", vec![0, 1], vec![0, 2]),
        ("large", vec![1; 262145], vec![2; 262145]),
    ] {
        fs::write(f.left.join(name), a)?;
        fs::write(f.right.join(name), b)?;
    }
    let plan = f.inspect().await?;
    assert_eq!(
        f.a.preview_conflict(&plan.id, &plan.digest, "binary")
            .await?
            .versions[0]
            .reason
            .as_deref(),
        Some("binary")
    );
    assert_eq!(
        f.a.preview_conflict(&plan.id, &plan.digest, "large")
            .await?
            .versions[0]
            .reason
            .as_deref(),
        Some("too_large")
    );
    assert!(
        f.a.preview_conflict(&plan.id, &plan.digest, "../outside")
            .await
            .is_err()
    );
    fs::write(f.left.join("binary"), b"changed")?;
    assert!(
        f.a.preview_conflict(&plan.id, &plan.digest, "binary")
            .await
            .is_err()
    );
    Ok(())
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p2_dependencies_are_in_final_preview_and_statistics_are_real() -> Result<()> {
    let f = Fixture::new().await?;
    fs::create_dir_all(f.left.join("a/b"))?;
    fs::write(f.left.join("a/b/file"), b"payload")?;
    let plan = f.inspect().await?;
    let requested = vec!["a/b/file".into()];
    let preview =
        f.a.preview_execution(&plan.id, &plan.digest, requested.clone())
            .await?;
    assert_eq!(preview.selected, vec!["a", "a/b", "a/b/file"]);
    let batch = f.a.execute(&plan.id, &plan.digest, requested).await?;
    assert_eq!(batch.done, 3);
    assert_eq!(fs::read(f.right.join("a/b/file"))?, b"payload");
    let report = f.a.engine.usage_report()?;
    assert_eq!(report.records.len(), 1);
    assert_eq!(report.records[0].files, 1);
    assert_eq!(report.records[0].bytes, "7");
    f.a.engine.set_usage_enabled(false)?;
    fs::write(f.left.join("another"), b"one")?;
    f.apply(f.inspect().await?, false).await?;
    assert_eq!(f.a.engine.usage_report()?.records.len(), 1);
    assert_eq!(f.a.engine.history()?.len(), 2);
    f.a.engine.clear_usage()?;
    assert!(f.a.engine.usage_report()?.records.is_empty());
    assert_eq!(f.a.engine.history()?.len(), 2);
    Ok(())
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p2_delete_vs_edit_choice_still_requires_risk_approval() -> Result<()> {
    use syncfu_core::conflicts::{Decision, DecisionRequest};
    let f = Fixture::new().await?;
    set_policy(&f, Direction::Bidirectional, Trust::Personal).await?;
    fs::write(f.left.join("file"), b"original")?;
    fs::write(f.right.join("file"), b"original")?;
    f.inspect().await?;
    fs::remove_file(f.left.join("file"))?;
    fs::write(f.right.join("file"), b"edited")?;
    let plan = f.inspect().await?;
    let next =
        f.a.resolve_plan(
            &plan.id,
            &plan.digest,
            vec![DecisionRequest {
                path: "file".into(),
                decision: Decision::Use {
                    source_device: f.a.device().id,
                },
            }],
        )
        .await?;
    assert_eq!(next.comparison.changes[0].action, Action::Delete);
    assert!(
        f.a.execute(&next.id, &next.digest, vec!["file".into()])
            .await
            .is_err()
    );
    let batch =
        f.a.execute_reviewed(&next.id, &next.digest, vec!["file".into()], true)
            .await?;
    assert_eq!(batch.done, 1);
    let undo = f.a.inspect_undo(&batch.id).await?;
    f.apply(undo, false).await?;
    assert_eq!(fs::read(f.right.join("file"))?, b"edited");
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "bounded 128 MiB transfer benchmark"]
async fn large_transfer_benchmark() -> Result<()> {
    let f = Fixture::new().await?;
    let data = (0..128 * 1024 * 1024usize)
        .map(|i| (i.wrapping_mul(31) % 251) as u8)
        .collect::<Vec<_>>();
    fs::write(f.left.join("payload.bin"), &data)?;
    let start = std::time::Instant::now();
    let plan = f.inspect().await?;
    let scan = start.elapsed();
    let start = std::time::Instant::now();
    let result = f.apply(plan, false).await?;
    let transfer = start.elapsed();
    assert_eq!(result.status, "completed");
    assert_eq!(fs::read(f.right.join("payload.bin"))?, data);
    eprintln!(
        "BENCH large_transfer bytes={} scan_ms={} transfer_ms={}",
        data.len(),
        scan.as_millis(),
        transfer.as_millis()
    );
    Ok(())
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "bounded personal-policy round trip benchmark"]
async fn direction_switch_benchmark() -> Result<()> {
    let f = Fixture::new().await?;
    set_policy(&f, Direction::Bidirectional, Trust::Personal).await?;
    let mut elapsed = Vec::new();
    for i in 0..6 {
        let current = f.a.engine.policy_state(&f.task.id)?.current;
        let mut next = current.clone();
        next.revision += 1;
        next.direction = if i % 2 == 0 {
            Direction::OneWayUpdate {
                source_device: f.a.device().id,
            }
        } else {
            Direction::Bidirectional
        };
        let start = std::time::Instant::now();
        f.a.propose_policy(&f.task.id, current.revision, next)
            .await?;
        elapsed.push(start.elapsed().as_millis());
        assert_eq!(
            f.a.engine.policy_state(&f.task.id)?.current,
            f.b.engine.policy_state(&f.task.id)?.current
        );
    }
    eprintln!("BENCH direction_switch personal_roundtrip_ms={elapsed:?}");
    Ok(())
}
