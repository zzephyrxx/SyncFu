import { wireProtocol } from '../generated/policy.ts';
import type { Plan, Snapshot, Task } from '../types.ts';
export function requireProtocol(value: unknown) { if(value!==wireProtocol)throw new Error('SyncFu 协议与界面版本不匹配，请同时更新两端并重启桌面应用。'); }
import type { DecisionRequest } from '../generated/policy.ts';
export function defaultSelection(plan: Plan) {
  return new Set(plan.comparison.changes.filter(change => plan.undo_of ? change.action !== 'conflict' : change.action === 'create' || change.action === 'update').map(change => change.path));
}
export function decisionSelection(plan: Plan, old: Set<string>, decisions: DecisionRequest[]) {
  const explicit = new Set(decisions.filter(d => d.decision.choice === 'use').map(d => d.path));
  return new Set(plan.comparison.changes.filter(change => change.action !== 'conflict' && (old.has(change.path) || explicit.has(change.path))).map(change => change.path));
}
export function handoffBlock(snapshot: Snapshot, task: Task): 'offline' | 'paused' | 'pendingPolicy' | 'resultPending' | 'directionBlocked' | null {
  const peer=snapshot.peers.find(p=>p.id===task.peer);const view=snapshot.policy_states.find(v=>v.task===task.id);
  if(!peer?.online)return 'offline';
  if(snapshot.paused_all||view?.paused)return 'paused';
  if(view?.state.pending)return 'pendingPolicy';
  if(snapshot.history.some(b=>b.task===task.id&&b.status==='pending'))return 'resultPending';
  const policy=view?.state.current;
  if(policy&&policy.direction.mode!=='bidirectional'&&policy.direction.source_device===task.peer)return 'directionBlocked';
  return null;
}
export function canConfirm(snapshot: Snapshot, plan: Plan, selected: string[]) {
  const view=snapshot.policy_states.find(p=>p.task===plan.task.id);
  return Boolean(selected.length&&view&&!view.paused&&!snapshot.paused_all&&!view.state.pending&&view.state.current.revision===plan.policy.revision&&!snapshot.history.some(b=>b.status==='pending')&&snapshot.peers.some(p=>p.id===plan.task.peer&&p.online)&&!plan.comparison.issues.length);
}
