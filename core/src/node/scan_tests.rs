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

async fn fixture() -> Result<Fixture> {
    let temp = tempfile::tempdir()?;
    let left = temp.path().join("left");
    let right = temp.path().join("right");
    fs::create_dir(&left)?;
    fs::create_dir(&right)?;
    fs::write(left.join("sample.txt"), b"source")?;
    fs::write(right.join("sample.txt"), b"receiver")?;
    let a = Node::start(
        Engine::open(&temp.path().join("a"))?,
        Identity::generate()?,
        "Scan A".into(),
        "127.0.0.1:0".parse()?,
        false,
    )
    .await?;
    let b = Node::start(
        Engine::open(&temp.path().join("b"))?,
        Identity::generate()?,
        "Scan B".into(),
        "127.0.0.1:0".parse()?,
        false,
    )
    .await?;
    // Seed approved identities; all calls below still cross mutual TLS.
    for (own, other) in [(&a, &b), (&b, &a)] {
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

#[tokio::test]
async fn real_scan_reports_both_sides_and_clears_snapshot_after_completion() -> Result<()> {
    let f = fixture().await?;
    let release = Arc::new(tokio::sync::Notify::new());
    let (server, _) = scan_peer_proxy(&f, false, Some(release.clone())).await?;
    // Sparse files are cheap to create and provide real work for local and
    // receiving snapshots. The TLS reply gate guarantees remote sampling even
    // when a fast machine finishes hashing before the 400 ms polling period.
    for path in [&f.left, &f.right] {
        let folder = path.join("nested");
        fs::create_dir(&folder)?;
        fs::File::create(folder.join("progress.bin"))?.set_len(64 * 1024 * 1024)?;
    }
    let inspect = f.a.inspect(&f.task.id);
    tokio::pin!(inspect);
    let mut local_seen = false;
    let mut remote_seen = false;
    let mut incoming_seen = false;
    let result = timeout(Duration::from_secs(60), async {
        loop {
            tokio::select! {
                result = &mut inspect => break result,
                _ = tokio::time::sleep(Duration::from_millis(10)) => {
                    if let Some(scan) = f.a.snapshot()?.scan {
                        assert_eq!(scan.task, f.task.id);
                        assert!(!scan.incoming);
                        local_seen |= scan.local.as_ref().is_some_and(|p| p.files_total > 0);
                        remote_seen |= scan.remote.as_ref().is_some_and(|p| p.files_total > 0);
                        if remote_seen { release.notify_one(); }
                    }
                    if let Some(scan) = f.b.snapshot()?.scan {
                        assert_eq!(scan.task, f.task.id);
                        assert!(scan.incoming);
                        incoming_seen |= scan.local.is_some();
                    }
                }
            }
        }
    })
    .await;
    server.abort();
    let plan = result??;
    assert!(
        plan.comparison.issues.is_empty(),
        "{:?}",
        plan.comparison.issues
    );
    assert!(
        local_seen,
        "the initiating device never exposed local scan progress"
    );
    assert!(
        remote_seen,
        "the initiating device never exposed remote scan progress"
    );
    assert!(
        incoming_seen,
        "the receiving device never exposed incoming scan progress"
    );
    assert!(f.a.snapshot()?.scan.is_none());
    assert!(f.b.snapshot()?.scan.is_none());
    assert!(f.a.snapshot()?.phase.is_none());
    Ok(())
}

#[tokio::test]
async fn scan_status_is_authorized_per_grant_and_legacy_scan_shape_still_works() -> Result<()> {
    let f = fixture().await?;
    let mut session = f.a.session(&f.a.peer(&f.b.device.id)?).await?;
    let before: Option<GrantScanReport> =
        session.call(Rpc::ScanStatus(f.task.remote.clone())).await?;
    assert!(before.is_none());
    // The Scan request keeps its pre-existing wire shape and Manifest reply.
    assert_eq!(
        serde_json::to_value(Rpc::Scan(f.task.remote.clone()))?,
        serde_json::json!({"Scan": f.task.remote})
    );
    let manifest: Manifest = session.call(Rpc::Scan(f.task.remote.clone())).await?;
    assert!(manifest.entries.contains_key("sample.txt"));
    let report: Option<GrantScanReport> =
        session.call(Rpc::ScanStatus(f.task.remote.clone())).await?;
    let report = report.context("completed scan report missing")?;
    assert_eq!(report.grant, f.task.remote);
    assert_eq!(report.progress.phase, ScanPhase::Complete);
    // Neither an ungranted peer nor an empty/local caller may inspect this path.
    assert!(
        f.b.rpc("unrelated-peer", Rpc::ScanStatus(f.task.remote.clone()))
            .is_err()
    );
    assert!(f.b.rpc("", Rpc::ScanStatus(f.task.remote.clone())).is_err());
    assert!(
        session
            .call::<Option<GrantScanReport>>(Rpc::ScanStatus("unknown-grant".into()))
            .await
            .is_err()
    );
    // A valid peer still cannot see a grant belonging to another peer.
    let private = f._temp.path().join("private");
    fs::create_dir(&private)?;
    fs::write(private.join("private.txt"), b"private")?;
    let other_grant = f.b.engine.grant("unrelated-peer", &private)?;
    f.b.scan_grant(&other_grant.id, "unrelated-peer", None)?;
    assert!(
        session
            .call::<Option<GrantScanReport>>(Rpc::ScanStatus(other_grant.id))
            .await
            .is_err()
    );
    // After revocation, a retained completed report must no longer be readable.
    f.b.scan_grant(&f.task.remote, &f.a.device.id, None)?;
    f.b.revoke(&f.task.remote)?;
    assert!(
        session
            .call::<Option<GrantScanReport>>(Rpc::ScanStatus(f.task.remote.clone()))
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn failed_remote_scan_waits_for_local_work_and_clears_activity() -> Result<()> {
    let f = fixture().await?;
    // The policy and authenticated connection remain valid, but its grant no
    // longer exists. This exercises error cleanup after local work was spawned.
    f.b.revoke(&f.task.remote)?;
    assert!(f.a.inspect(&f.task.id).await.is_err());
    assert!(f.a.snapshot()?.scan.is_none());
    assert!(f.a.snapshot()?.phase.is_none());
    let report = lock(&f.a.scan_report)
        .clone()
        .context("local scan did not finish")?;
    assert_eq!(report.progress.phase, ScanPhase::Complete);
    assert!(
        f.a.scan_gate.try_lock().is_ok(),
        "local work remains in flight after failure"
    );
    assert!(f.b.snapshot()?.scan.is_none());
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn incomplete_scan_keeps_changes_visible_but_cannot_prepare_writes() -> Result<()> {
    let f = fixture().await?;
    // A portable-name violation is deterministic on every host and represents
    // an incomplete scan without relying on administrator-specific permissions.
    fs::write(f.left.join("CON.txt"), b"unsupported portable name")?;
    let plan = f.a.inspect(&f.task.id).await?;
    assert!(!plan.comparison.issues.is_empty());
    assert!(
        plan.comparison
            .changes
            .iter()
            .any(|change| change.path == "sample.txt")
    );
    assert!(
        f.a.prepare_work(&plan.id, &plan.digest, vec!["sample.txt".into()])
            .is_err()
    );
    assert!(f.a.snapshot()?.scan.is_none());
    assert!(f.b.snapshot()?.scan.is_none());
    assert!(f.a.engine.active()?.is_none());
    assert_eq!(fs::read(f.right.join("sample.txt"))?, b"receiver");
    Ok(())
}

// A TLS peer that speaks all existing requests but disconnects on the new
// optional variant, exactly as an older serde Rpc enum would do.
async fn serve_scan_peer(
    node: Arc<Node>,
    peer: String,
    mut tcp: TcpStream,
    rejected: Arc<AtomicUsize>,
    reject_status: bool,
    hold_scan: Option<Arc<tokio::sync::Notify>>,
) -> Result<()> {
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
    let roots = vec![node.peer(&peer)?.cert];
    let mut tls = TlsAcceptor::from(node.identity.server_config(&roots, false)?)
        .accept(tcp)
        .await?;
    loop {
        let value: serde_json::Value = receive(&mut tls).await?;
        if reject_status && value.get("ScanStatus").is_some() {
            rejected.fetch_add(1, Ordering::SeqCst);
            return Ok(());
        }
        let request: Rpc = serde_json::from_value(value)?;
        let is_scan = matches!(&request, Rpc::Scan(_));
        let own = node.clone();
        let caller = peer.clone();
        let reply: Reply = tokio::task::spawn_blocking(move || own.rpc(&caller, request))
            .await?
            .map_err(|error| format!("{error:#}"));
        // Keep the original Scan reply in flight until the observer confirms a
        // status sample. This deterministically exercises optional progress even
        // on machines where content hashing takes less than one polling period.
        if is_scan && let Some(release) = &hold_scan {
            release.notified().await;
        }
        send(&mut tls, &reply).await?;
    }
}

async fn scan_peer_proxy(
    f: &Fixture,
    reject_status: bool,
    hold_scan: Option<Arc<tokio::sync::Notify>>,
) -> Result<(tokio::task::JoinHandle<()>, Arc<AtomicUsize>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let mut peer = f.a.peer(&f.b.device.id)?;
    peer.address = address.to_string();
    f.a.engine.store.put("peers", &peer.id, &peer)?;
    lock(&f.a.reachable).insert(peer.id, address);
    let rejected = Arc::new(AtomicUsize::new(0));
    let rejected_for_server = rejected.clone();
    let server_node = f.b.clone();
    let caller = f.a.device.id.clone();
    let server = tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let node = server_node.clone();
            let peer = caller.clone();
            let rejected = rejected_for_server.clone();
            let hold_scan = hold_scan.clone();
            tokio::spawn(async move {
                let _ = serve_scan_peer(node, peer, tcp, rejected, reject_status, hold_scan).await;
            });
        }
    });
    Ok((server, rejected))
}

#[tokio::test]
async fn missing_optional_status_rpc_does_not_break_a_legacy_peer_scan() -> Result<()> {
    let f = fixture().await?;
    let (server, rejected) = scan_peer_proxy(&f, true, None).await?;
    let result = timeout(Duration::from_secs(15), f.a.inspect(&f.task.id)).await;
    server.abort();
    let plan = result??;
    assert!(
        rejected.load(Ordering::SeqCst) > 0,
        "optional status endpoint was never exercised"
    );
    assert!(plan.comparison.issues.is_empty());
    assert!(
        plan.comparison
            .changes
            .iter()
            .any(|change| change.path == "sample.txt")
    );
    assert!(f.a.snapshot()?.scan.is_none());
    Ok(())
}
