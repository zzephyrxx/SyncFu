// P1 desktop boundary for P2 consumers. Never imported by the isolated prototype.
import { command } from './api';
import { policyCommands, type ExecutionPreview, type PolicyState, type PolicyView, type TaskPolicy, type ConflictPreview, type DecisionRequest, type ReviewNote, type UsageReport } from './generated/policy';
import type { Batch, Plan } from './types';
export const policyApi = {
  resolvePlan: (plan: string, digest: string, decisions: DecisionRequest[]) => command<Plan>(policyCommands.resolvePlan, { plan, digest, decisions }),
  previewConflict: (plan: string, digest: string, path: string) => command<ConflictPreview>(policyCommands.previewConflict, { plan, digest, path }),
  reviewNotes: (task: string) => command<ReviewNote[]>(policyCommands.reviewNotes, { task }),
  clearReviewNote: (task: string, path: string) => command<void>(policyCommands.clearReviewNote, { task, path }),
  usage: () => command<UsageReport>(policyCommands.usage),
  usageEnabled: (enabled: boolean) => command<void>(policyCommands.usageEnabled, { enabled }),
  clearUsage: () => command<void>(policyCommands.clearUsage),
  get: (task: string) => command<PolicyView>(policyCommands.taskPolicy, { task }),
  propose: (task: string, expectedRevision: number, next: TaskPolicy) => command<PolicyState>(policyCommands.propose, { task, expectedRevision, next }),
  answer: (task: string, proposal: string, accept: boolean) => command<PolicyState>(policyCommands.answer, { task, proposal, accept }),
  reconcile: (task: string) => command<PolicyState>(policyCommands.reconcile, { task }),
  pauseTask: (task: string, paused: boolean) => command<void>(policyCommands.pauseTask, { task, paused }),
  pauseAll: (paused: boolean) => command<void>(policyCommands.pauseAll, { paused }),
  preview: (plan: string, digest: string, selected: string[]) => command<ExecutionPreview>(policyCommands.previewExecution, { plan, digest, selected }),
  execute: (plan: string, digest: string, selected: string[], approveRisk = false) => command<Batch>(policyCommands.execute, { plan, digest, selected, approveRisk }),
};
