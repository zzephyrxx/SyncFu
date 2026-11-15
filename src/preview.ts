import type { Plan, Snapshot, Task, Entry } from './types';

const task: Task = { id: 'example-task', peer: 'example-peer', local: 'example-local', remote: 'example-remote', label: '研究资料', local_path: '/Users/example/Documents/研究资料', remote_path: 'D:\\Documents\\研究资料' };
const file = (bytes: number, hash = 'example'): Entry => ({ type: 'file', sha256: hash, bytes });
// Explicitly fictional, read-only demonstration, activated only by ?preview.
export const previewSnapshot: Snapshot = {
  protocol: 3,
  device: { id: 'example-self', name: '我的 MacBook（示例）', port: 0 },
  peers: [{ id: 'example-peer', name: '书房 Windows（示例）', address: '示例地址', online: true }],
  nearby: [], pending: [], tasks: [task], dirty: [task.id], phase: null, network_error: null,
  policy_states: [], paused_all: false, automatic_supported: false,
  history: [{ id: 'example-batch', task: task.id, label: task.label, created: 1794328200, status: 'completed', done: 18, total: 18, skipped: 0, message: null, undo_available: false, undo_of: null }],
};
export const previewPlan: Plan = {
  id: 'example-plan', task, digest: 'example-not-executable', undo_of: null,
  policy: { revision: 0, digest: 'example-not-executable' },
  conflicts: [], resolutions: [], review_notes: [],
  comparison: { same: 284, total: 291, ignored: 3, issues: [], changes: [
    { path: '笔记/阅读笔记.md', action: 'update', target: 1, before: file(8142, 'old'), after: file(12480) },
    { path: '笔记/十一月研究计划.md', action: 'create', target: 1, before: null, after: file(2480) },
    { path: '文献/分布式系统导论.pdf', action: 'create', target: 0, before: null, after: file(2180400) },
    { path: '文献/参考文献.bib', action: 'update', target: 0, before: file(18000, 'old'), after: file(24800) },
    { path: '图表/实验结果.csv', action: 'update', target: 1, before: file(8400, 'old'), after: file(12640) },
    { path: '草稿/旧版提纲.md', action: 'delete', target: 1, before: file(2040), after: null },
    { path: '草稿/论文初稿.docx', action: 'conflict', target: 0, before: file(45200, 'a'), after: file(47800, 'b') },
  ] },
};
