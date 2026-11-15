use crate::{
    engine::{self, Engine, Work},
    files,
    model::*,
    policy::*,
    risk::{self, DeletionWindow, RiskAssessment, RiskPermit},
    store,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, sync::atomic::Ordering};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct LocalPause {
    pub all: bool,
    pub tasks: BTreeSet<String>,
}
impl Engine {
    pub fn bind_device(&self, device: &str) -> Result<()> {
        ensure!(valid_device(device), "本机身份标识无效");
        if let Some(previous) = self.store.get::<String>("config", "device")? {
            ensure!(previous == device, "应用数据目录属于另一设备身份");
        } else {
            self.store.put("config", "device", &device)?;
        }
        for task in self.tasks()? {
            if self.store.get::<PolicyState>("policy", &task.id)?.is_none() {
                let state = PolicyState {
                    current: TaskPolicy::legacy(&task, device)?,
                    pending: None,
                    last_receipt: None,
                };
                self.store.put("policy", &task.id, &state)?;
            }
            self.policy_state(&task.id)?.current.validate()?;
        }
        Ok(())
    }
    pub fn local_device(&self) -> Result<String> {
        self.store
            .get("config", "device")?
            .context("设备身份尚未绑定")
    }
    pub fn policy_state(&self, task: &str) -> Result<PolicyState> {
        self.store
            .get("policy", task)?
            .context("任务策略缺失，请核对数据")
    }
    pub fn policy_views(&self) -> Result<Vec<PolicyView>> {
        self.tasks()?
            .into_iter()
            .map(|task| {
                Ok(PolicyView {
                    state: self.policy_state(&task.id)?,
                    paused: self.is_paused(&task.id)?,
                    task: task.id,
                })
            })
            .collect()
    }
    pub fn link_task(&self, task: &Task) -> Result<()> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        let local = self.local_device()?;
        let policy = TaskPolicy::legacy(task, &local)?;
        self.root(&task.local, &task.peer)?;
        if let Some(old) = self.store.get::<Task>("tasks", &task.id)? {
            ensure!(
                old.peer == task.peer && old.local == task.local && old.remote == task.remote,
                "任务关联已存在且不一致"
            );
            return Ok(());
        }
        ensure!(self.active()?.is_none(), "请先结束当前批次");
        ensure!(
            !self.tasks()?.iter().any(|old| old.local == task.local),
            "目录已关联其他任务，不能建立影子关联"
        );
        let mut db = self.store.conn();
        let tx = db.transaction()?;
        store::put(&tx, "tasks", &task.id, task)?;
        store::put(
            &tx,
            "policy",
            &task.id,
            &PolicyState {
                current: policy,
                pending: None,
                last_receipt: None,
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn offer_policy(&self, proposal: &Proposal, actor: &str) -> Result<PolicyState> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        ensure!(self.active()?.is_none(), "批次进行中不能修改策略");
        let mut state = self.policy_state(&proposal.next.task)?;
        ensure!(actor == proposal.proposed_by, "提案发起身份不一致");
        if state
            .last_receipt
            .as_ref()
            .is_some_and(|r| r.proposal == proposal.id)
        {
            ensure!(
                state
                    .last_receipt
                    .as_ref()
                    .is_some_and(|r| proposal.fingerprint().is_ok_and(|hash| hash == r.digest)),
                "提案标识被复用"
            );
            return Ok(state);
        }
        if let Some(pending) = &state.pending {
            if pending.proposal == *proposal {
                return Ok(state);
            }
            proposal.validate(&state.current)?;
            ensure!(
                state.current.revision == pending.proposal.expected_revision
                    && (&proposal.proposed_by, &proposal.id)
                        < (&pending.proposal.proposed_by, &pending.proposal.id),
                "另一策略提案已获得版本预留，请先核对"
            );
            state.last_receipt = Some(PolicyReceipt {
                proposal: pending.proposal.id.clone(),
                digest: pending.proposal.fingerprint()?,
                outcome: ReceiptOutcome::Rejected,
            });
        }
        proposal.validate(&state.current)?;
        let task = self.task(&proposal.next.task)?;
        self.root(&task.local, &task.peer)?;
        let accepted = actor == self.local_device()? || proposal.automatic_consent(&state.current);
        state.pending = Some(PendingPolicy {
            proposal: proposal.clone(),
            accepted,
        });
        self.store.put("policy", &task.id, &state)?;
        Ok(state)
    }
    pub fn answer_policy(
        &self,
        task: &str,
        proposal_id: &str,
        accept: bool,
    ) -> Result<PolicyState> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        ensure!(self.active()?.is_none(), "批次进行中不能答复策略");
        let mut state = self.policy_state(task)?;
        let pending = state.pending.as_mut().context("没有待答复提案")?;
        ensure!(pending.proposal.id == proposal_id, "提案已变化");
        if accept {
            pending.accepted = true;
        } else {
            ensure!(
                !pending.accepted && state.current.revision == pending.proposal.expected_revision,
                "已接受的提案须先核对，不能单方撤销"
            );
            state.last_receipt = Some(PolicyReceipt {
                proposal: proposal_id.into(),
                digest: pending.proposal.fingerprint()?,
                outcome: ReceiptOutcome::Rejected,
            });
            state.pending = None;
        }
        self.store.put("policy", task, &state)?;
        Ok(state)
    }
    pub fn commit_policy(
        &self,
        task: &str,
        proposal_id: &str,
        expected_digest: &str,
    ) -> Result<PolicyState> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        ensure!(self.active()?.is_none(), "批次进行中不能提交策略");
        let mut state = self.policy_state(task)?;
        if let Some(receipt) = &state.last_receipt
            && receipt.proposal == proposal_id
        {
            ensure!(
                receipt.digest == expected_digest && receipt.outcome == ReceiptOutcome::Committed,
                "提案已拒绝或摘要不同"
            );
            return Ok(state);
        }
        let pending = state.pending.as_ref().context("没有可提交提案")?;
        ensure!(
            pending.accepted
                && pending.proposal.id == proposal_id
                && pending.proposal.fingerprint()? == expected_digest,
            "提案尚未由本端接受"
        );
        pending.proposal.validate(&state.current)?;
        state.current = pending.proposal.next.clone();
        state.last_receipt = Some(PolicyReceipt {
            proposal: proposal_id.into(),
            digest: expected_digest.into(),
            outcome: ReceiptOutcome::Committed,
        });
        // Keep the reservation until both current policies have been committed.
        self.store.put("policy", task, &state)?;
        Ok(state)
    }
    pub fn confirm_policy(
        &self,
        task: &str,
        proposal_id: &str,
        expected_digest: &str,
    ) -> Result<PolicyState> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        let mut state = self.policy_state(task)?;
        ensure!(
            state
                .last_receipt
                .as_ref()
                .is_some_and(|r| r.proposal == proposal_id
                    && r.digest == expected_digest
                    && r.outcome == ReceiptOutcome::Committed),
            "缺少策略提交凭据"
        );
        if let Some(pending) = &state.pending {
            ensure!(
                pending.proposal.id == proposal_id && pending.proposal.next == state.current,
                "策略确认不一致"
            );
        }
        state.pending = None;
        self.store.put("policy", task, &state)?;
        Ok(state)
    }
    pub fn acknowledge_rejection(
        &self,
        task: &str,
        receipt: &PolicyReceipt,
    ) -> Result<PolicyState> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        let mut state = self.policy_state(task)?;
        let pending = state.pending.as_ref().context("没有待核对提案")?;
        ensure!(
            receipt.outcome == ReceiptOutcome::Rejected
                && pending.proposal.id == receipt.proposal
                && pending.proposal.fingerprint()? == receipt.digest
                && state.current.revision == pending.proposal.expected_revision,
            "拒绝凭据与当前提案不符"
        );
        state.pending = None;
        state.last_receipt = Some(receipt.clone());
        self.store.put("policy", task, &state)?;
        Ok(state)
    }
    pub fn is_paused(&self, task: &str) -> Result<bool> {
        let pause = self
            .pauses
            .lock()
            .map_err(|_| anyhow::anyhow!("暂停状态不可用"))?;
        Ok(pause.all || pause.tasks.contains(task))
    }
    pub fn all_paused(&self) -> Result<bool> {
        Ok(self
            .pauses
            .lock()
            .map_err(|_| anyhow::anyhow!("暂停状态不可用"))?
            .all)
    }
    pub fn set_paused(&self, task: Option<&str>, paused: bool) -> Result<()> {
        if let Some(task) = task {
            self.task(task)?;
        }
        let mut pause = self
            .pauses
            .lock()
            .map_err(|_| anyhow::anyhow!("暂停状态不可用"))?;
        let mut next = pause.clone();
        if let Some(task) = task {
            if paused {
                next.tasks.insert(task.into());
            } else {
                next.tasks.remove(task);
            }
        } else {
            next.all = paused;
        }
        let active = self
            .active()?
            .filter(|work| task.is_none_or(|task| task == work.batch.task));
        if paused {
            *pause = next.clone();
            if active.is_some() {
                self.cancelled.store(true, Ordering::Release);
            }
        }
        let mut db = self.store.conn();
        let tx = db.transaction()?;
        store::put(&tx, "config", "pause", &next)?;
        if paused && let Some(work) = active {
            store::put(&tx, "stopped", &work.batch.id, &true)?;
        }
        tx.commit()
            .context("暂停状态无法持久化；当前进程仍保持安全暂停")?;
        *pause = next;
        Ok(())
    }
    pub fn stop_work(&self, work: &Work) -> Result<()> {
        self.cancelled.store(true, Ordering::Release);
        self.store.put("stopped", &work.batch.id, &true)
    }
    pub fn work_digest(&self, work: &Work) -> Result<String> {
        let policy = self.policy_state(&work.batch.task)?.current;
        let local = self.local_device()?;
        let auth = work
            .authorization
            .as_ref()
            .context("旧批次只可核对，不能重新执行")?;
        let ops = work.ops.iter().map(|op| Ok(serde_json::json!({"id":op.id,"change":policy.canonical_changes(std::slice::from_ref(&op.change),&local)?,"previous":op.previous,"previous_known":op.previous_known}))).collect::<Result<Vec<_>>>()?;
        digest(
            &serde_json::json!({"batch":work.batch,"auth_version":auth.version,"owner":work.owner,"policy":auth.policy_digest,"origin":auth.origin,"baseline":auth.baseline_digest,"facts":auth.facts,"planned":policy.canonical_changes(&auth.planned,&local)?,"resolutions":auth.resolutions,"ops":ops,"common":work.common}),
        )
    }
    pub fn require_current_work(&self, work: &Work) -> Result<TaskPolicy> {
        ensure!(!self.is_paused(&work.batch.task)?, "本机已暂停此任务");
        ensure!(
            !self
                .store
                .get::<bool>("stopped", &work.batch.id)?
                .unwrap_or(false),
            "此批次已停止，请先核对并重新检查"
        );
        let state = self.policy_state(&work.batch.task)?;
        let policy = state.ready()?.clone();
        let auth = work
            .authorization
            .as_ref()
            .context("旧批次缺少新版授权，只能核对恢复")?;
        ensure!(
            auth.version == SCHEMA_VERSION,
            "此批次使用旧授权格式，只能核对恢复"
        );
        ensure!(
            policy.fingerprint()? == auth.policy_digest,
            "策略已变化，请重新检查"
        );
        ensure!(
            auth.origin != ExecutionOrigin::Automatic,
            "自动调度尚未启用"
        );
        ensure!(
            (auth.origin == ExecutionOrigin::Undo) == work.batch.undo_of.is_some(),
            "执行来源与撤销记录不一致"
        );
        Ok(policy)
    }
    pub fn preflight(&self, work: &Work) -> Result<RiskAssessment> {
        let policy = self.require_current_work(work)?;
        policy.validate()?;
        engine::valid_id(&work.batch.id)?;
        ensure!(
            !work.ops.is_empty()
                && work.batch.total == work.ops.len()
                && work.batch.done == 0
                && work.batch.status == "pending",
            "批次数量或初始状态无效"
        );
        ensure!(
            work.ops.windows(2).all(|pair| pair[0].id < pair[1].id),
            "批次操作顺序无效"
        );
        let local = self.local_device()?;
        let task = self.task(&work.batch.task)?;
        ensure!(
            policy.endpoints == TaskPolicy::legacy(&task, &local)?.endpoints
                && policy.contains(&work.owner),
            "批次不属于当前设备关系"
        );
        ensure!(work.digest == self.work_digest(work)?, "批次授权摘要不一致");
        let auth = work.authorization.as_ref().context("缺少执行授权")?;
        ensure!(
            auth.facts.len() == 2
                && auth.planned.len() <= files::LIMIT
                && work.ops.len() <= files::LIMIT
                && work.common.len() <= files::LIMIT,
            "计划证明数量无效"
        );
        let baseline = self.pair_state(&task.id)?;
        ensure!(auth.baseline_digest == digest(&baseline)?, "同步基线已变化");
        let manifest = policy.filter(&self.root(&task.local, &task.peer)?.scan());
        ensure!(manifest.issues.is_empty(), "目录扫描未完成，不能写入");
        let fact = ManifestProof::new(&manifest)?;
        ensure!(
            auth.facts
                .get(&local)
                .is_some_and(|p| p.digest == fact.digest && p.files == fact.files),
            "检查后目录内容已变化，请重新检查"
        );
        for endpoint in &policy.endpoints {
            ensure!(
                auth.facts.contains_key(&endpoint.device),
                "缺少端点扫描证明"
            );
        }
        let resolutions = self.validate_resolutions(work, &policy, &local)?;
        let mut paths = BTreeSet::new();
        for c in &auth.planned {
            policy.validate_change(c, &local, work.batch.undo_of.is_some())?;
            ensure!(
                paths.insert(files::portable_key(&c.path)),
                "计划包含重复路径"
            );
            if work.batch.undo_of.is_none() && policy.direction == Direction::Bidirectional {
                let unchanged_target = baseline
                    .base
                    .get(&c.path)
                    .map_or(c.before.is_none(), |previous| {
                        previous.as_ref() == c.before.as_ref()
                    });
                ensure!(
                    unchanged_target || resolutions.get(&c.path) == Some(c),
                    "双向任务的接收端也有变化，必须先明确处理冲突"
                );
            }
            let expected = if c.target == 0 || work.batch.undo_of.is_some() {
                &c.before
            } else {
                &c.after
            };
            ensure!(
                manifest.entries.get(&c.path) == expected.as_ref(),
                "计划与本端文件状态不符：{}",
                c.path
            );
        }
        let planned = auth
            .planned
            .iter()
            .map(|change| (change.path.as_str(), change))
            .collect::<std::collections::BTreeMap<_, _>>();
        let mut selected_paths = BTreeSet::new();
        for op in &work.ops {
            engine::valid_id(&op.id)?;
            ensure!(
                selected_paths.insert(files::portable_key(&op.change.path)),
                "选择路径重复"
            );
            ensure!(
                planned.get(op.change.path.as_str()).copied() == Some(&op.change),
                "选择不是已审阅计划的子集"
            );
            if work.batch.undo_of.is_none() {
                ensure!(
                    op.previous_known == baseline.base.contains_key(&op.change.path)
                        && op.previous == baseline.base.get(&op.change.path).cloned().flatten(),
                    "操作基线元数据不一致"
                );
            }
        }
        for (path, value) in &work.common {
            files::validate_path(path)?;
            ensure!(
                !policy.is_excluded(path) && manifest.entries.get(path) == value.as_ref(),
                "共同基线不是本端已核验内容"
            );
        }
        let source_empty = work.batch.undo_of.is_none()
            && fact.files == 0
            && work
                .ops
                .iter()
                .any(|op| op.change.target == 1 && risk::is_file_delete(&op.change));
        let window = self
            .store
            .get::<DeletionWindow>("delete_window", &task.id)?
            .unwrap_or_default();
        Ok(risk::assess(
            &local,
            &auth.planned,
            &work.ops,
            risk::RiskSnapshot {
                files: fact.files,
                source_empty,
                now: engine::now(),
            },
            &window,
            &policy.deletion,
        ))
    }
    pub(crate) fn verify_frozen_work(&self, work: &Work) -> Result<()> {
        let stored = self.work(&work.batch.id)?;
        ensure!(
            stored.digest == work.digest && work.digest == self.work_digest(work)?,
            "批次内容与已批准记录不同"
        );
        let policy = self.require_current_work(work)?;
        let local = self.local_device()?;
        for op in &work.ops {
            policy.validate_change(&op.change, &local, work.batch.undo_of.is_some())?;
        }
        Ok(())
    }
    pub fn approve_work_risk(&self, work: &Work, actor: &str) -> Result<()> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| anyhow::anyhow!("设备状态不可用"))?;
        ensure!(self.active()?.is_none(), "已有批次进行中，不能另行批准风险");
        let policy = self.require_current_work(work)?;
        ensure!(policy.can_manage(actor), "只有已分类任务的管理端可批准风险");
        self.preflight(work)?;
        self.store.put(
            "risk_permit",
            &work.batch.id,
            &RiskPermit {
                work_digest: work.digest.clone(),
                policy_digest: policy.fingerprint()?,
                expires_at: engine::now().saturating_add(300),
            },
        )
    }
    pub(crate) fn require_risk_permit(
        &self,
        work: &Work,
        assessment: &RiskAssessment,
    ) -> Result<()> {
        if assessment.reasons.is_empty() {
            return Ok(());
        }
        let permit = self
            .store
            .get::<RiskPermit>("risk_permit", &work.batch.id)?
            .context("需要管理端核对并批准此次删除风险")?;
        ensure!(
            permit.work_digest == work.digest
                && permit.expires_at > engine::now()
                && work
                    .authorization
                    .as_ref()
                    .is_some_and(|a| a.policy_digest == permit.policy_digest),
            "风险批准已过期或内容已变化"
        );
        Ok(())
    }
}
