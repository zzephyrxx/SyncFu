use super::*;
use std::{fs, path::PathBuf};
use tokio::io::AsyncWriteExt;

struct Fixture {
    a: Arc<Node>,
    b: Arc<Node>,
    task: Task,
    left: PathBuf,
    right: PathBuf,
    _temp: tempfile::TempDir,
}
async fn fixture(shared: bool, mirror_mode: bool) -> Result<Fixture> {
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
        "A".into(),
        "127.0.0.1:0".parse()?,
        false,
    )
    .await?;
    let b = Node::start(
        Engine::open(&temp.path().join("b"))?,
        Identity::generate()?,
        "B".into(),
        "127.0.0.1:0".parse()?,
        false,
    )
    .await?;
    // Seed already-approved identities; these tests target the authenticated RPC boundary.
    // The separate pairing and transport suites exercise the PAKE and mutual TLS handshakes.
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
    let ga = a.grant(&b.device.id, &left)?;
    let gb = b.grant(&a.device.id, &right)?;
    let task = a.create_task(&b.device.id, &ga.id, &gb.id).await?;
    let mut next = a.engine.policy_state(&task.id)?.current;
    next.revision = 1;
    next.trust = if shared {
        Trust::Shared {
            owner_device: a.device.id.clone(),
        }
    } else {
        Trust::Personal
    };
    next.direction = if mirror_mode {
        Direction::OneWayMirror {
            source_device: a.device.id.clone(),
        }
    } else {
        Direction::OneWayUpdate {
            source_device: a.device.id.clone(),
        }
    };
    a.propose_policy(&task.id, 0, next).await?;
    let proposal = b
        .engine
        .policy_state(&task.id)?
        .pending
        .context("提案缺失")?
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
async fn shared_bidirectional_conflict_cannot_be_disguised_as_an_update() -> Result<()> {
    let f = fixture(true, false).await?;
    let plan = f.b.inspect(&f.task.id).await?;
    let (_, expected, mut work) =
        f.b.prepare_work(&plan.id, &plan.digest, vec!["sample.txt".into()])?;
    let mut next = f.a.engine.policy_state(&f.task.id)?.current;
    let revision = next.revision;
    next.revision += 1;
    next.direction = Direction::Bidirectional;
    f.a.propose_policy(&f.task.id, revision, next).await?;
    let change = &mut work.ops[0].change;
    std::mem::swap(&mut change.before, &mut change.after);
    change.target = 1;
    let auth = work.authorization.as_mut().context("缺少授权")?;
    auth.policy_digest = f.a.engine.policy_state(&f.task.id)?.current.fingerprint()?;
    auth.planned = vec![work.ops[0].change.clone()];
    work.digest = f.b.engine.work_digest(&work)?;
    assert!(
        f.a.rpc(
            &f.b.device.id,
            Rpc::Begin {
                work: mirror(&work),
                expected: expected.clone()
            }
        )
        .is_err()
    );
    let policy = f.a.engine.policy_state(&f.task.id)?.current;
    let change = &work.ops[0].change;
    let versions = BTreeMap::from([
        (f.a.device.id.clone(), change.before.clone()),
        (f.b.device.id.clone(), change.after.clone()),
    ]);
    let conflict = crate::conflicts::ConflictDescriptor {
        path: change.path.clone(),
        fingerprint: crate::conflicts::conflict_fingerprint(&policy, &change.path, &versions)?,
        versions,
        resolvable: true,
    };
    work.authorization
        .as_mut()
        .context("缺少授权")?
        .resolutions
        .push(crate::conflicts::ConflictResolution {
            conflict,
            source_device: f.b.device.id.clone(),
        });
    work.digest = f.b.engine.work_digest(&work)?;
    assert!(
        f.a.rpc(
            &f.b.device.id,
            Rpc::Begin {
                work: mirror(&work),
                expected
            }
        )
        .is_err()
    );
    assert!(f.a.engine.active()?.is_none());
    assert_eq!(fs::read(f.left.join("sample.txt"))?, b"source");
    assert_eq!(fs::read(f.right.join("sample.txt"))?, b"receiver");
    Ok(())
}

#[tokio::test]
async fn reverse_work_is_rejected_at_the_inbound_boundary() -> Result<()> {
    let f = fixture(false, false).await?;
    let plan = f.b.inspect(&f.task.id).await?;
    let (_, expected, work) =
        f.b.prepare_work(&plan.id, &plan.digest, vec!["sample.txt".into()])?;
    let mut forged = mirror(&work);
    forged.ops[0].change.target = 0;
    forged.authorization.as_mut().context("授权缺失")?.planned[0].target = 0;
    forged.digest = f.a.engine.work_digest(&forged)?;
    assert!(
        f.a.rpc(
            &f.b.device.id,
            Rpc::Begin {
                work: forged,
                expected
            }
        )
        .is_err()
    );
    assert!(f.a.engine.active()?.is_none());
    assert_eq!(fs::read(f.left.join("sample.txt"))?, b"source");
    Ok(())
}

#[tokio::test]
async fn shared_receiver_cannot_forge_a_manager_risk_permit() -> Result<()> {
    let f = fixture(true, true).await?;
    for i in 0..103 {
        fs::write(f.right.join(format!("extra-{i}.txt")), b"extra")?;
    }
    let plan = f.b.inspect(&f.task.id).await?;
    let selected = plan
        .comparison
        .changes
        .iter()
        .map(|c| c.path.clone())
        .collect();
    let (_, _, work) = f.b.prepare_work(&plan.id, &plan.digest, selected)?;
    assert!(f.b.rpc("", Rpc::ApproveRisk(work.clone())).is_err());
    assert!(
        f.a.rpc(&f.b.device.id, Rpc::ApproveRisk(mirror(&work)))
            .is_err()
    );
    let mut false_owner = mirror(&work);
    false_owner.owner = f.a.device.id.clone();
    false_owner.digest = f.a.engine.work_digest(&false_owner)?;
    assert!(
        f.a.rpc(&f.b.device.id, Rpc::ApproveRisk(false_owner))
            .is_err()
    );
    assert!(
        f.b.engine
            .store
            .get::<crate::risk::RiskPermit>("risk_permit", &work.batch.id)?
            .is_none()
    );
    assert!(f.right.join("extra-0.txt").exists());
    Ok(())
}

#[tokio::test]
async fn duplicate_link_preserves_policy_and_shadow_link_is_denied() -> Result<()> {
    let f = fixture(true, false).await?;
    let before = f.b.engine.task(&f.task.id)?;
    let policy = f.b.engine.policy_state(&f.task.id)?.current;
    let mut duplicate = before.clone();
    duplicate.label = "overwrite".into();
    duplicate.remote_path = "untrusted".into();
    f.b.rpc(&f.a.device.id, Rpc::Link(duplicate))?;
    assert_eq!(
        serde_json::to_value(f.b.engine.task(&f.task.id)?)?,
        serde_json::to_value(&before)?
    );
    assert_eq!(f.b.engine.policy_state(&f.task.id)?.current, policy);
    let mut shadow = before;
    shadow.remote = engine::id();
    shadow.id = pair_key(&shadow.local, &shadow.remote)?;
    assert!(f.b.rpc(&f.a.device.id, Rpc::Link(shadow)).is_err());
    assert_eq!(f.b.engine.tasks()?.len(), 1);
    Ok(())
}

#[tokio::test]
async fn invalid_begin_cannot_cancel_the_valid_local_reservation() -> Result<()> {
    let f = fixture(false, false).await?;
    let (victim, attacker) = if f.a.device.id > f.b.device.id {
        (&f.a, &f.b)
    } else {
        (&f.b, &f.a)
    };
    let plan = victim.inspect(&f.task.id).await?;
    let (_, expected, legitimate) =
        victim.prepare_work(&plan.id, &plan.digest, vec!["sample.txt".into()])?;
    victim.engine.begin(&legitimate, &expected)?;
    let mut forged = legitimate.clone();
    forged.batch.id = engine::id();
    forged.owner = attacker.device.id.clone();
    forged
        .authorization
        .as_mut()
        .context("缺少授权")?
        .policy_digest = "0".repeat(64);
    forged.digest = victim.engine.work_digest(&forged)?;
    assert!(
        victim
            .rpc(
                &attacker.device.id,
                Rpc::Begin {
                    work: forged,
                    expected
                }
            )
            .is_err()
    );
    assert_eq!(
        victim
            .engine
            .active()?
            .context("原批次被无效请求取消")?
            .batch
            .id,
        legitimate.batch.id
    );
    Ok(())
}

#[tokio::test]
async fn automatic_origin_is_rejected_until_the_scheduler_is_implemented() -> Result<()> {
    let f = fixture(false, false).await?;
    let plan = f.a.inspect(&f.task.id).await?;
    let (_, _, mut work) =
        f.a.prepare_work(&plan.id, &plan.digest, vec!["sample.txt".into()])?;
    work.authorization.as_mut().context("缺少授权")?.origin = ExecutionOrigin::Automatic;
    work.digest = f.a.engine.work_digest(&work)?;
    assert!(
        f.b.rpc(&f.a.device.id, Rpc::Preflight(mirror(&work)))
            .is_err()
    );
    assert!(!f.a.snapshot()?.automatic_supported);
    assert_eq!(fs::read(f.right.join("sample.txt"))?, b"receiver");
    Ok(())
}

#[tokio::test]
async fn old_frame_protocol_is_rejected_explicitly() -> Result<()> {
    for version in 1..PROTOCOL {
        let (mut writer, mut reader) = tokio::io::duplex(1024);
        writer.write_all(&[b'S', b'F', b'U', version]).await?;
        let error = receive::<serde_json::Value>(&mut reader)
            .await
            .expect_err("旧协议不应被接受");
        assert!(format!("{error:#}").contains("协议版本不一致"));
    }
    Ok(())
}
