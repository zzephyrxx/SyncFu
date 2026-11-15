import { invoke, isTauri } from '@tauri-apps/api/core';
import { wireProtocol } from './generated/policy';
import type { Snapshot } from './types';

export const desktop = isTauri();
export const preview = !desktop && new URLSearchParams(window.location.search).has('preview');
export const emptySnapshot: Snapshot = {
  protocol: wireProtocol,
  device: { id: '', name: '本机', port: 0 }, peers: [], nearby: [], pending: [],
  tasks: [], history: [], dirty: [], phase: null, network_error: null,
  policy_states: [], paused_all: false, automatic_supported: false,
};
export async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktop) throw new Error('此操作需要在 SyncFu 桌面版中完成。浏览器不会访问文件或连接设备。');
  return invoke<T>(name, args);
}
export function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
