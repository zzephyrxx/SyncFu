import type { PolicyStamp, PolicyView, ConflictDescriptor, ConflictResolution, ReviewNote } from './generated/policy';

export interface Device { id: string; name: string; port: number; addresses?: string[] }
export interface Peer { id: string; name: string; address: string; online: boolean }
export interface Nearby { id: string; name: string; address: string }
export interface Folder { id: string; label: string; path: string }
export interface Task {
  id: string; peer: string; local: string; remote: string; label: string;
  local_path: string; remote_path: string;
}
export type Entry = { type: 'file'; sha256: string; bytes: number } | { type: 'directory' };
export type Action = 'create' | 'update' | 'delete' | 'conflict';
export interface Change { path: string; action: Action; target: number; before: Entry | null; after: Entry | null }
export interface Comparison { changes: Change[]; same: number; total: number; ignored: number; issues: string[] }
export interface Plan { id: string; task: Task; comparison: Comparison; digest: string; undo_of: string | null; policy: PolicyStamp; conflicts: ConflictDescriptor[]; resolutions: ConflictResolution[]; review_notes: ReviewNote[] }
export interface Batch {
  id: string; task: string; label: string; created: number; status: string;
  undo_of: string | null; done: number; total: number; skipped: number;
  message: string | null; undo_available: boolean;
}
export interface Snapshot {
  protocol: number;
  device: Device; peers: Peer[]; nearby: Nearby[]; pending: Nearby[];
  tasks: Task[]; history: Batch[]; dirty: string[]; phase: string | null; network_error: string | null;
  policy_states: PolicyView[]; paused_all: boolean; automatic_supported: boolean;
}
export interface Settings { days: number; quota: number; location: string; autostart: boolean; updates_available: boolean }
export type Page = 'tasks' | 'devices' | 'history' | 'settings';
