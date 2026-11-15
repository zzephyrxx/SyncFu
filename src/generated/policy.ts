// Generated from Rust Serde DTOs. Do not edit.
// cargo run -p syncfu-core --features bindings --example export_policy_contract

export type Entry = { "type": "file", sha256: string, bytes: number, } | { "type": "directory" };
export type ConflictDescriptor = { path: string, versions: { [key in string]?: Entry | null }, fingerprint: string, resolvable: boolean, };
export type ConflictResolution = { conflict: ConflictDescriptor, source_device: string, };
export type Decision = { "choice": "use", source_device: string, } | { "choice": "later" } | { "choice": "ignore_version" };
export type DecisionRequest = { path: string, decision: Decision, };
export type ReviewNote = { task: string, path: string, fingerprint: string, ignored: boolean, };
export type FilePreview = { device: string, entry: Entry | null, text: string | null, reason: string | null, };
export type ConflictPreview = { path: string, versions: Array<FilePreview>, };
export type UsageRecord = { id: string, created: number, files: number, bytes: string, };
export type UsageReport = { enabled: boolean, records: Array<UsageRecord>, };
export type Endpoint = { device: string, grant: string, };
export type Direction = { "mode": "bidirectional" } | { "mode": "one_way_update", source_device: string, } | { "mode": "one_way_mirror", source_device: string, };
export type Trigger = "manual" | "on_change";
export type Trust = { "kind": "unclassified" } | { "kind": "personal" } | { "kind": "shared", owner_device: string, };
export type ConflictRule = { "kind": "hold" } | { "kind": "prefer_device", device: string, };
export type DeleteRules = { max_files: number, relative_min: number, percent: number, window_seconds: number, };
export type TaskPolicy = { task: string, revision: number, endpoints: [Endpoint, Endpoint], direction: Direction, trigger: Trigger, trust: Trust, conflicts: ConflictRule, excludes: Array<string>, deletion: DeleteRules, };
export type Proposal = { id: string, expected_revision: number, next: TaskPolicy, proposed_by: string, };
export type PendingPolicy = { proposal: Proposal, accepted: boolean, };
export type ReceiptOutcome = "committed" | "rejected";
export type PolicyReceipt = { proposal: string, digest: string, outcome: ReceiptOutcome, };
export type PolicyState = { current: TaskPolicy, pending: PendingPolicy | null, last_receipt: PolicyReceipt | null, };
export type PolicyStamp = { revision: number, digest: string, };
export type PolicyView = { task: string, state: PolicyState, paused: boolean, };
export type RiskReason = "large_deletion" | "relative_deletion" | "source_empty";
export type RiskAssessment = { device: string, planned_deletions: number, selected_deletions: number, recent_deletions: number, baseline_files: number, reasons: Array<RiskReason>, };
export type ExecutionPreview = { plan: string, digest: string, selection_digest: string, risks: Array<RiskAssessment>, approval_required: boolean, selected: Array<string>, };

export const policyCommands = {
  "answer": "answer_task_policy",
  "clearReviewNote": "clear_review_note",
  "clearUsage": "clear_usage",
  "execute": "execute_plan",
  "pauseAll": "pause_all",
  "pauseTask": "pause_task",
  "previewConflict": "preview_conflict",
  "previewExecution": "preview_execution",
  "propose": "propose_task_policy",
  "reconcile": "reconcile_task_policy",
  "resolvePlan": "resolve_plan",
  "reviewNotes": "review_notes",
  "taskPolicy": "task_policy",
  "usage": "usage_report",
  "usageEnabled": "set_usage_enabled"
} as const;
export const wireProtocol = 4 as const;
