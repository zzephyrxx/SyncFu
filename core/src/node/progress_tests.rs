use super::*;
use std::{fs, path::PathBuf, sync::atomic::AtomicUsize};

struct Fixture {
    a: Arc<Node>,
    b: Arc<Node>,
    task: Task,
    left: PathBuf,
    right: PathBuf,
    _temp: tempfile::TempDir,
}

fn trust(a: &Arc<Node>, b: &Arc<Node>) -> Result<()> {
    for (own, other) in [(a, b), (b, a)] {
        own.engine.store.put(
            "peers",
            &other.device.id,
            &Peer {
                id: other.device.id.clone(),
                name: other.device.name.clone(),
                address: format!("127.0.0.1:{}", other.device.port),
                cert: other.identity.cert_der().to_vec(),
                leaf: other.identity.leaf_der().to_vec(),
            },
        )?;
    }
    Ok(())
}

async fn fixture(files: usize) -> Result<Fixture> {
    let temp = tempfile::tempdir()?;
    let left = temp.path().join("left");
    let right = temp.path().join("right");
    fs::create_dir(&left)?;
    fs::create_dir(&right)?;
    for i in 0..files {
        fs::write(left.join(format!("{i:04}.txt")), format!("contents-{i}"))?;
    }
    let a = Node::start(
        Engine::open(&temp.path().join("a"))?,
        Identity::generate()?,
        "Progress A".into(),
        "127.0.0.1:0".parse()?,
        false,
    )
    .await?;
    let b = Node::start(
        Engine::open(&temp.path().join("b"))?,
        Identity::generate()?,
        "Progress B".into(),
        "127.0.0.1:0".parse()?,
        false,
    )
    .await?;
    trust(&a, &b)?;
    let local = a.grant(&b.device.id, &left)?;
    let remote = b.grant(&a.device.id, &right)?;
    let task = a.create_task(&b.device.id, &local.id, &remote.id).await?;
    let mut policy = a.engine.policy_state(&task.id)?.current;
    policy.revision = 1;
    policy.trust = Trust::Personal;
    policy.direction = Direction::OneWayUpdate {
        source_device: a.device.id.clone(),
    };
    a.propose_policy(&task.id, 0, policy).await?;
    let proposal = b
        .engine
        .policy_state(&task.id)?
        .pending
        .context("missing proposal")?
        .proposal
        .id;
    b.answer_policy(&task.id, &proposal, true).await?;
    Ok(Fixture {
        a,
        b,
        task,
        left,
        right,
        _temp: temp,
    })
}

#[derive(Default)]
struct Gate {
    reached: tokio::sync::Notify,
    release: tokio::sync::Notify,
}
impl Gate {
    async fn hold(&self) {
        self.reached.notify_one();
        self.release.notified().await;
    }
    async fn entered(&self) -> Result<()> {
        timeout(Duration::from_secs(30), self.reached.notified()).await?;
        Ok(())
    }
}

async fn proxy(
    f: &Fixture,
    before: Option<Arc<Gate>>,
    after: Option<Arc<Gate>>,
    reject_progress: bool,
    stalled_progress: Option<Arc<AtomicUsize>>,
) -> Result<tokio::task::JoinHandle<()>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let mut peer = f.a.peer(&f.b.device.id)?;
    peer.address = address.to_string();
    f.a.engine.store.put("peers", &peer.id, &peer)?;
    lock(&f.a.reachable).insert(peer.id, address);
    let node = f.b.clone();
    let caller = f.a.device.id.clone();
    Ok(tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            let node = node.clone();
            let caller = caller.clone();
            let before = before.clone();
            let after = after.clone();
            let stalled_progress = stalled_progress.clone();
            tokio::spawn(async move {
                let result: Result<()> = async {
                    send(
                        &mut tcp,
                        &Hello {
                            cert: node.identity.cert_der().to_vec(),
                            leaf: node.identity.leaf_der().to_vec(),
                            name: node.device.name.clone(),
                            session: None,
                        },
                    )
                    .await?;
                    let config = node
                        .identity
                        .server_config(&[node.peer(&caller)?.cert], false)?;
                    let mut tls = TlsAcceptor::from(config).accept(tcp).await?;
                    loop {
                        let request: Rpc = receive(&mut tls).await?;
                        if reject_progress && matches!(&request, Rpc::Progress { .. }) {
                            return Ok(());
                        }
                        if matches!(&request, Rpc::Progress { .. })
                            && let Some(count) = &stalled_progress
                            && count.fetch_add(1, Ordering::SeqCst) == 0
                        {
                            // This response remains blocked beyond the client timeout.
                            // A correct client must abandon this framed stream.
                            tokio::time::sleep(Duration::from_secs(60)).await;
                        }
                        let apply = matches!(&request, Rpc::Apply(_));
                        if apply && let Some(gate) = &before {
                            gate.hold().await;
                        }
                        let own = node.clone();
                        let peer = caller.clone();
                        let reply: Reply =
                            tokio::task::spawn_blocking(move || own.rpc(&peer, request))
                                .await?
                                .map_err(|error| format!("{error:#}"));
                        if apply && let Some(gate) = &after {
                            gate.hold().await;
                        }
                        send(&mut tls, &reply).await?;
                    }
                }
                .await;
                let _ = result;
            });
        }
    }))
}

async fn execute(f: &Fixture) -> Result<tokio::task::JoinHandle<Result<Batch>>> {
    let plan = f.a.inspect(&f.task.id).await?;
    assert!(
        plan.comparison.issues.is_empty(),
        "{:?}",
        plan.comparison.issues
    );
    let selected = plan
        .comparison
        .changes
        .iter()
        .map(|c| c.path.clone())
        .collect();
    let node = f.a.clone();
    Ok(tokio::spawn(async move {
        node.execute(&plan.id, &plan.digest, selected).await
    }))
}

fn local_events(node: &Node, batch: &str) -> Vec<FileProgress> {
    let mut cursor = 0;
    let mut events = vec![];
    loop {
        let page = node.execution_progress(Some(batch), cursor);
        assert!(page.events.len() <= 256);
        assert_eq!(page.cursor, cursor + page.events.len());
        cursor = page.cursor;
        events.extend(page.events);
        if !page.more {
            return events;
        }
    }
}

async fn remote_events(
    session: &mut Session,
    ticket: &Ticket,
) -> Result<(ExecutionProgress, Vec<FileProgress>)> {
    let mut cursor = 0;
    let mut events = vec![];
    loop {
        let page: ProgressPage = session
            .call(Rpc::Progress {
                ticket: ticket.clone(),
                after: cursor,
            })
            .await?;
        assert!(page.events.len() <= 256);
        assert_eq!(page.cursor, cursor + page.events.len());
        cursor = page.cursor;
        events.extend(page.events);
        if !page.more {
            return Ok((page.summary.context("missing progress")?, events));
        }
    }
}

#[tokio::test]
async fn tls_progress_pages_track_waiting_transfer_and_persisted_file_completion() -> Result<()> {
    let f = fixture(300).await?;
    let before = Arc::new(Gate::default());
    let after = Arc::new(Gate::default());
    let server = proxy(&f, Some(before.clone()), Some(after.clone()), false, None).await?;
    let operation = execute(&f).await?;
    before.entered().await?;
    let work = f.b.engine.active()?.context("missing remote batch")?;
    let ticket = Ticket::from(work.as_ref());
    let staged = local_events(&f.a, &ticket.id);
    assert_eq!(staged.iter().filter(|e| e.state == "waiting").count(), 300);
    assert_eq!(
        staged.iter().filter(|e| e.state == "transferred").count(),
        300
    );
    assert!(staged.iter().all(|e| e.state != "applied"));
    assert_eq!(f.a.execution_progress(None, 0).summary.unwrap().done, 0);
    let incoming = f.b.execution_progress(None, 0).summary.unwrap();
    assert_eq!(incoming.stage, "verify");
    assert_eq!(incoming.transferred_bytes, incoming.total_bytes);
    assert!(incoming.transferred_bytes > 0);
    assert_eq!(incoming.current_bytes, incoming.current_total);
    assert_eq!(incoming.done, 0);
    assert!(!f.right.join("0000.txt").exists());
    before.release.notify_one();
    after.entered().await?;
    let mut session = f.a.session(&f.a.peer(&f.b.device.id)?).await?;
    let (summary, events) = remote_events(&mut session, &ticket).await?;
    assert_eq!(summary.done, 300);
    assert_eq!(events.iter().filter(|e| e.state == "waiting").count(), 300);
    assert_eq!(events.iter().filter(|e| e.state == "applied").count(), 300);
    timeout(Duration::from_secs(5), async {
        while f.a.execution_progress(None, 0).summary.unwrap().done != 300 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    for i in 0..300 {
        assert_eq!(
            fs::read_to_string(f.right.join(format!("{i:04}.txt")))?,
            format!("contents-{i}")
        );
    }
    after.release.notify_one();
    let batch = timeout(Duration::from_secs(30), operation).await???;
    assert_eq!(batch.status, "completed");
    assert_eq!(batch.done, 300);
    for node in [&f.a, &f.b] {
        let summary = node.execution_progress(None, 0).summary.unwrap();
        assert_eq!(summary.done, 300);
        assert_eq!(summary.stage, "completed");
        assert!(!summary.running);
    }
    server.abort();
    Ok(())
}

#[tokio::test]
async fn tls_progress_requires_the_exact_batch_digest_and_task_peer() -> Result<()> {
    let f = fixture(1).await?;
    let batch = execute(&f).await?.await??;
    let work = f.b.engine.work(&batch.id)?;
    let ticket = Ticket::from(&work);
    let mut session = f.a.session(&f.a.peer(&f.b.device.id)?).await?;
    remote_events(&mut session, &ticket).await?;
    for invalid in [
        Ticket {
            id: engine::id(),
            digest: ticket.digest.clone(),
        },
        Ticket {
            id: ticket.id.clone(),
            digest: "wrong".into(),
        },
    ] {
        assert!(
            session
                .call::<ProgressPage>(Rpc::Progress {
                    ticket: invalid,
                    after: 0
                })
                .await
                .is_err()
        );
    }
    let third = Node::start(
        Engine::open(&f._temp.path().join("third"))?,
        Identity::generate()?,
        "Unrelated peer".into(),
        "127.0.0.1:0".parse()?,
        false,
    )
    .await?;
    trust(&third, &f.b)?;
    let mut unauthorized = third.session(&third.peer(&f.b.device.id)?).await?;
    assert!(
        unauthorized
            .call::<ProgressPage>(Rpc::Progress {
                ticket: ticket.clone(),
                after: 0
            })
            .await
            .is_err()
    );
    f.b.engine.store.delete("peers", &f.a.device.id)?;
    assert!(
        session
            .call::<ProgressPage>(Rpc::Progress { ticket, after: 0 })
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn cancellation_after_transfer_never_reports_unapplied_files_as_complete() -> Result<()> {
    let f = fixture(3).await?;
    let before = Arc::new(Gate::default());
    let server = proxy(&f, Some(before.clone()), None, false, None).await?;
    let operation = execute(&f).await?;
    before.entered().await?;
    f.a.cancel().await?;
    before.release.notify_one();
    let batch = timeout(Duration::from_secs(30), operation).await???;
    assert_eq!(batch.status, "cancelled");
    assert_eq!(batch.done, 0);
    for node in [&f.a, &f.b] {
        let summary = node.execution_progress(None, 0).summary.unwrap();
        assert_eq!(summary.done, 0);
        assert_eq!(summary.stage, "cancelled");
        assert!(!summary.running);
        assert!(
            local_events(node, &batch.id)
                .iter()
                .all(|e| e.state != "applied")
        );
    }
    assert!(!f.right.join("0000.txt").exists());
    server.abort();
    Ok(())
}

#[tokio::test]
async fn partial_apply_marks_only_persisted_files_complete() -> Result<()> {
    let f = fixture(3).await?;
    let before = Arc::new(Gate::default());
    let server = proxy(&f, Some(before.clone()), None, false, None).await?;
    let operation = execute(&f).await?;
    before.entered().await?;
    let work = f.b.engine.active()?.context("missing remote batch")?;
    let first = work.ops[0].change.path.clone();
    let failing = work.ops[1].change.path.clone();
    fs::write(f.right.join(&failing), b"external edit")?;
    before.release.notify_one();
    let batch = timeout(Duration::from_secs(30), operation).await???;
    assert_eq!(batch.status, "partial");
    assert_eq!(batch.done, 1);
    assert_eq!(
        fs::read(f.right.join(&first))?,
        fs::read(f.left.join(&first))?
    );
    assert_eq!(fs::read(f.right.join(&failing))?, b"external edit");
    for node in [&f.a, &f.b] {
        let summary = node.execution_progress(None, 0).summary.unwrap();
        assert_eq!(summary.done, 1);
        assert_eq!(summary.stage, "partial");
        assert!(!summary.running);
        let events = local_events(node, &batch.id);
        assert_eq!(
            events
                .iter()
                .filter(|e| e.state == "applied")
                .map(|e| e.path.as_str())
                .collect::<Vec<_>>(),
            vec![first.as_str()]
        );
    }
    assert!(
        local_events(&f.b, &batch.id)
            .iter()
            .any(|e| e.path == failing && e.state == "failed")
    );
    server.abort();
    Ok(())
}

#[tokio::test]
async fn dropped_incoming_connection_stops_its_live_progress() -> Result<()> {
    let f = fixture(1).await?;
    let plan = f.a.inspect(&f.task.id).await?;
    let (_, expected, work) =
        f.a.prepare_work(&plan.id, &plan.digest, vec!["0000.txt".into()])?;
    let mut session = f.a.session(&f.a.peer(&f.b.device.id)?).await?;
    session
        .call::<()>(Rpc::Begin {
            work: mirror(&work),
            expected,
        })
        .await?;
    assert!(f.b.execution_progress(None, 0).summary.unwrap().running);
    drop(session);
    timeout(Duration::from_secs(5), async {
        while f.b.execution_progress(None, 0).summary.unwrap().running {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    let summary = f.b.execution_progress(None, 0).summary.unwrap();
    assert_eq!(summary.stage, "interrupted");
    assert_eq!(summary.done, 0);
    assert!(
        f.b.engine.active()?.is_some(),
        "disconnect must retain the batch for reconciliation"
    );
    Ok(())
}

#[tokio::test]
async fn missing_optional_progress_rpc_does_not_prevent_apply() -> Result<()> {
    let f = fixture(3).await?;
    let after = Arc::new(Gate::default());
    let server = proxy(&f, None, Some(after.clone()), true, None).await?;
    let operation = execute(&f).await?;
    after.entered().await?;
    // Leave time for the optional status connection to be rejected.
    tokio::time::sleep(Duration::from_millis(400)).await;
    after.release.notify_one();
    let batch = timeout(Duration::from_secs(30), operation).await???;
    assert_eq!(batch.status, "completed");
    assert_eq!(batch.done, 3);
    assert_eq!(f.a.execution_progress(None, 0).summary.unwrap().done, 3);
    server.abort();
    Ok(())
}

#[tokio::test]
async fn large_directory_task_executes_beyond_former_entry_limit() -> Result<()> {
    let f = fixture(0).await?;
    const COUNT: usize = 20_017;
    for i in 0..COUNT {
        fs::create_dir(f.left.join(format!("dir-{i:05}")))?;
    }
    let operation = execute(&f).await?;
    let batch = timeout(Duration::from_secs(600), operation).await???;
    assert_eq!(batch.status, "completed", "{:?}", batch.message);
    assert_eq!(batch.done, COUNT);
    for i in 0..COUNT {
        assert!(f.right.join(format!("dir-{i:05}")).is_dir());
    }
    let summary = f.a.execution_progress(None, 0).summary.unwrap();
    assert_eq!(summary.done, COUNT);
    assert_eq!(summary.total, COUNT);
    assert!(!summary.running);
    assert_eq!(
        local_events(&f.a, &batch.id)
            .iter()
            .filter(|e| e.state == "applied")
            .count(),
        COUNT
    );
    Ok(())
}

#[tokio::test]
async fn unavailable_extra_status_connection_does_not_block_existing_apply_session() -> Result<()> {
    let f = fixture(0).await?;
    fs::create_dir(f.left.join("new-folder"))?;
    let plan = f.a.inspect(&f.task.id).await?;
    let (_, expected, work) =
        f.a.prepare_work(&plan.id, &plan.digest, vec!["new-folder".into()])?;
    f.a.engine.begin(&work, &expected)?;
    f.a.start_progress(&work);
    let mut session = f.a.session(&f.a.peer(&f.b.device.id)?).await?;
    session
        .call::<()>(Rpc::Begin {
            work: mirror(&work),
            expected,
        })
        .await?;
    let ticket = Ticket::from(&work);
    f.a.local_unit(Rpc::Seal(ticket.clone())).await?;
    session.call::<()>(Rpc::Seal(ticket.clone())).await?;
    // The original TLS stream remains connected, but opening another one fails.
    let mut unreachable = f.a.peer(&f.b.device.id)?;
    unreachable.address = "127.0.0.1:0".into();
    lock(&f.a.reachable).remove(&unreachable.id);
    lock(&f.a.nearby).remove(&unreachable.id);
    assert!(
        timeout(
            Duration::from_secs(10),
            f.a.remote_apply(&mut session, &ticket, &unreachable)
        )
        .await??
        .is_none()
    );
    assert!(f.right.join("new-folder").is_dir());
    let batch = f.a.finish_pair(&work, None).await?;
    assert_eq!(batch.status, "completed");
    Ok(())
}

#[tokio::test]
async fn timed_out_progress_stream_is_replaced_before_polling_resumes() -> Result<()> {
    let f = fixture(1).await?;
    let after = Arc::new(Gate::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let server = proxy(&f, None, Some(after.clone()), false, Some(calls.clone())).await?;
    let operation = execute(&f).await?;
    after.entered().await?;
    timeout(Duration::from_secs(8), async {
        while f.a.execution_progress(None, 0).summary.unwrap().done != 1 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    assert!(calls.load(Ordering::SeqCst) >= 2);
    after.release.notify_one();
    let batch = timeout(Duration::from_secs(15), operation).await???;
    assert_eq!(batch.status, "completed");
    assert_eq!(batch.done, 1);
    server.abort();
    Ok(())
}

#[tokio::test]
async fn both_peers_report_transfer_bytes_without_counting_repeated_reads_twice() -> Result<()> {
    let f = fixture(1).await?;
    let plan = f.a.inspect(&f.task.id).await?;
    let (_, expected, work) =
        f.a.prepare_work(&plan.id, &plan.digest, vec!["0000.txt".into()])?;
    f.a.engine.begin(&work, &expected)?;
    f.a.start_progress(&work);
    let ticket = Ticket::from(&work);
    let mut receiver = f.a.session(&f.a.peer(&f.b.device.id)?).await?;
    receiver
        .call::<()>(Rpc::Begin {
            work: mirror(&work),
            expected,
        })
        .await?;
    let mut source = f.b.session(&f.b.peer(&f.a.device.id)?).await?;
    let op = work.ops[0].id.clone();
    let data: String = source
        .call(Rpc::Read {
            ticket: ticket.clone(),
            op: op.clone(),
            offset: 0,
        })
        .await?;
    let repeated: String = source
        .call(Rpc::Read {
            ticket: ticket.clone(),
            op: op.clone(),
            offset: 0,
        })
        .await?;
    assert_eq!(data, repeated);
    let bytes = STANDARD.decode(&data)?.len() as u64;
    receiver
        .call::<()>(Rpc::Chunk {
            ticket: ticket.clone(),
            op: op.clone(),
            offset: 0,
            data: data.clone(),
        })
        .await?;
    // A repeated chunk is rejected by IO and must not inflate its progress.
    assert!(
        receiver
            .call::<()>(Rpc::Chunk {
                ticket: ticket.clone(),
                op,
                offset: 0,
                data
            })
            .await
            .is_err()
    );
    for node in [&f.a, &f.b] {
        let summary = node.execution_progress(None, 0).summary.unwrap();
        assert_eq!(summary.stage, "transfer");
        assert_eq!(summary.current_path, "0000.txt");
        assert_eq!(summary.transferred_bytes, bytes);
        assert_eq!(summary.current_bytes, bytes);
        assert_eq!(summary.done, 0);
    }
    f.a.cancel().await?;
    let batch =
        f.a.finish_pair(&work, Some("cancelled test transfer".into()))
            .await?;
    assert_eq!(batch.status, "cancelled");
    Ok(())
}
