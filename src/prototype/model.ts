import { previewPlan, previewSnapshot } from '../preview.ts';
import type { Entry } from '../types';
const sizeOf = (entry: Entry | null) => entry?.type === 'file' ? entry.bytes : undefined;

// In-memory prototype only. This module must never import api.ts or Tauri.
export type Mode = 'both' | 'update' | 'mirror';
export type Resolution = 'local' | 'remote' | 'later' | 'version' | 'exclude';
export type Scenario = 'changes' | 'clean' | 'offline' | 'empty' | 'permission' | 'partial' | 'shared';
export interface DemoChange {
  path: string; kind: 'create' | 'update' | 'delete' | 'conflict';
  target: 'local' | 'remote'; size: number; selected: boolean;
  resolution?: Resolution; text?: boolean; localSize?: number; remoteSize?: number;
}
export interface DemoTask {
  id: string; name: string; localPath: string; remotePath: string;
  mode: Mode; source: 'local' | 'remote'; automatic: boolean;
  trust: 'personal' | 'shared'; owner: boolean; online: boolean;
  paused: boolean; risk: boolean; problem?: 'permission' | 'partial';
  changes: DemoChange[];
}
export const localDevice = '我的 MacBook';
export const remoteDevice = '书房 Windows';
export const modeNames: Record<Mode, string> = { both: '双向同步', update: '单向更新', mirror: '单向镜像' };
export const modeDetails: Record<Mode, string> = {
  both: '两端的变化互相同步，同时修改的文件由你决定。',
  update: '只向接收端新增和更新，保留接收端独有文件。',
  mirror: '以源端为准，接收端的额外文件也将列入删除计划。',
};
export const resolutionNames: Record<Resolution, string> = {
  local: `使用 ${localDevice} 版`, remote: `使用 ${remoteDevice} 版`,
  later: '稍后处理', version: '忽略当前版本', exclude: '永久排除此路径',
};
export function makeTasks(scenario: Scenario = 'changes'): DemoTask[] {
  if (scenario === 'empty') return [];
  const changes: DemoChange[] = previewPlan.comparison.changes.map(c => ({
    path: c.path, kind: c.action, target: c.target === 0 ? 'local' : 'remote',
    size: c.after?.type === 'file' ? c.after.bytes : c.before?.type === 'file' ? c.before.bytes : 0,
    selected: c.action === 'create' || c.action === 'update',
    localSize: sizeOf(c.action === 'conflict' || c.target === 0 ? c.before : c.after),
    remoteSize: sizeOf(c.action === 'conflict' || c.target === 0 ? c.after : c.before),
  }));
  changes.unshift({ path: '笔记/工作交接.md', kind: 'conflict', target: 'remote', size: 1840, localSize: 1840, remoteSize: 2160, selected: false, text: true });
  const docs: DemoTask = {
    id: 'docs', name: previewPlan.task.label, localPath: previewPlan.task.local_path,
    remotePath: previewPlan.task.remote_path, mode: 'both', source: 'local', automatic: true,
    trust: 'personal', owner: true, online: scenario !== 'offline', paused: false, risk: false,
    changes: scenario === 'clean' ? [] : changes,
    problem: scenario === 'permission' ? 'permission' : scenario === 'partial' ? 'partial' : undefined,
  };
  if (scenario === 'shared') { docs.trust = 'shared'; docs.owner = false; docs.mode = 'update'; docs.source = 'remote'; }
  return [docs, {
    ...docs, id: 'photos', name: '精选照片', localPath: '/Users/you/Pictures/精选照片', remotePath: 'D:\\Pictures\\精选照片',
    mode: 'update', source: 'local', automatic: true, trust: 'personal', owner: true, online: true, changes: [], problem: undefined,
  }, {
    ...docs, id: 'project', name: '项目归档', localPath: '/Users/you/Projects/交付归档', remotePath: 'D:\\Archive\\交付归档',
    mode: 'mirror', source: 'local', automatic: false, trust: 'personal', owner: true, online: true, risk: true, problem: undefined,
    changes: Array.from({ length: 103 }, (_, n) => ({
      path: `旧版交付/附件-${String(n + 1).padStart(3, '0')}.pdf`, kind: 'delete', target: 'remote', size: 24000, selected: false,
    })),
  }];
}
export const sampleHistory = previewSnapshot.history;
export function isIgnored(c: DemoChange) { return c.resolution === 'version' || c.resolution === 'exclude'; }
export function managedChanges(task: DemoTask) { return task.changes.filter(c => task.mode !== 'update' || c.kind !== 'delete'); }
export function targetOf(task: DemoTask, c: DemoChange) { return task.mode === 'both' || c.kind === 'conflict' ? c.target : task.source === 'local' ? 'remote' : 'local'; }
export function isPending(c: DemoChange) { return c.kind === 'conflict' && (!c.resolution || c.resolution === 'later'); }
export function isExecutable(c: DemoChange) { return !isIgnored(c) && !isPending(c); }
export function chosenChanges(task: DemoTask) { return managedChanges(task).filter(c => c.selected && isExecutable(c)); }
export function canManage(task: DemoTask) { return task.trust === 'personal' || task.owner; }
export function canResolve(task: DemoTask, resolution: Resolution) {
  if (!canManage(task)) return false;
  if (resolution === 'local' || resolution === 'remote') return task.mode === 'both' || task.source === resolution;
  return true;
}
export function resolveChange(task: DemoTask, path: string, resolution: Resolution): DemoTask {
  if (!canResolve(task, resolution)) return task;
  return { ...task, changes: task.changes.map(c => c.path === path && c.kind === 'conflict' ? {
    ...c, resolution, selected: resolution === 'local' || resolution === 'remote',
    size: resolution === 'local' ? c.localSize ?? c.size : resolution === 'remote' ? c.remoteSize ?? c.size : c.size,
    target: resolution === 'local' ? 'remote' : resolution === 'remote' ? 'local' : c.target,
  } : c) };
}
export function executeDemo(task: DemoTask) {
  if (!task.online || task.paused || task.risk || task.problem) return { task, applied: [] as DemoChange[] };
  const selected = chosenChanges(task);
  const paths = new Set(selected.map(c => c.path));
  const applied = selected.map(c => ({ ...c, target: targetOf(task, c) }));
  return { task: { ...task, changes: task.changes.filter(c => !paths.has(c.path)) }, applied };
}
export function statusOf(task: DemoTask) {
  if (!task.online) return '设备离线';
  if (task.paused) return '已暂停';
  if (task.problem === 'permission') return '需要目录授权';
  if (task.problem === 'partial') return '等待核对';
  if (task.risk) return '删除保护已触发';
  const managed = managedChanges(task);
  const pending = managed.filter(isPending).length;
  if (pending) return `${pending} 项待决定`;
  if (managed.some(c => !isIgnored(c))) return '有变化';
  return managed.length ? '有已忽略项' : '文件已一致';
}
export function restoreDemo(task: DemoTask, changes: DemoChange[]): DemoTask {
  const paths = new Set(changes.map(c => c.path));
  return { ...task, paused: true, changes: [...task.changes.filter(c => !paths.has(c.path)), ...changes.map(c => ({ ...c }))] };
}
export const scenarios: { id: Scenario; name: string }[] = [
  { id: 'changes', name: '变化与冲突' }, { id: 'clean', name: '文件已一致' }, { id: 'offline', name: '设备离线' },
  { id: 'empty', name: '首次使用' }, { id: 'permission', name: '目录权限不足' }, { id: 'partial', name: '中断与核对' },
  { id: 'shared', name: '他人共享 · 接收端' },
];
