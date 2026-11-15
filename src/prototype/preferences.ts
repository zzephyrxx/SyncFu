import { languages, type Locale } from './messages.ts';
import type { Mode } from './model.ts';
export interface Preferences {
  locale: Locale; theme: 'light' | 'dark' | 'system'; density: 'comfortable' | 'compact';
  accent: 'violet' | 'ocean' | 'graphite'; motion: 'full' | 'reduced' | 'off';
  beginner: boolean; illustrations: boolean; sidebarCollapsed: boolean; startup: 'tasks' | 'overview';
  defaultMode: Mode; defaultAuto: boolean; confirmNormal: boolean;
  backupDays: number; backupQuota: number; successMessages: boolean; usageEnabled: boolean;
}
export const preferenceKey = 'syncfu-prototype:v2:preferences';
export const defaults: Preferences = { locale: 'zh-CN', theme: 'light', density: 'comfortable', accent: 'violet', motion: 'full', beginner: false, illustrations: true, sidebarCollapsed: false, startup: 'tasks', defaultMode: 'both', defaultAuto: false, confirmNormal: true, backupDays: 30, backupQuota: 10, successMessages: true, usageEnabled: true };
export function normalisePreferences(value: unknown): Preferences {
  const result = { ...defaults };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const v = value as Record<string, unknown>;
  if (typeof v.locale === 'string' && Object.hasOwn(languages, v.locale)) result.locale = v.locale as Locale;
  for (const key of ['beginner', 'illustrations', 'sidebarCollapsed', 'defaultAuto', 'confirmNormal', 'successMessages', 'usageEnabled'] as const) if (typeof v[key] === 'boolean') result[key] = v[key];
  const enums = { theme: ['light', 'dark', 'system'], density: ['comfortable', 'compact'], accent: ['violet', 'ocean', 'graphite'], motion: ['full', 'reduced', 'off'], startup: ['tasks', 'overview'], defaultMode: ['both', 'update', 'mirror'] } as const;
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) if (typeof v[key] === 'string' && (enums[key] as readonly string[]).includes(v[key] as string)) Object.assign(result, { [key]: v[key] });
  if (Number.isInteger(v.backupDays) && Number(v.backupDays) >= 1 && Number(v.backupDays) <= 3650) result.backupDays = Number(v.backupDays);
  if (Number.isInteger(v.backupQuota) && Number(v.backupQuota) >= 1 && Number(v.backupQuota) <= 10000) result.backupQuota = Number(v.backupQuota);
  return result;
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readPreferences(storage: StorageLike, key = preferenceKey): Preferences { try { return normalisePreferences(JSON.parse(storage.getItem(key) ?? 'null')); } catch { return { ...defaults }; } }
export function persistPreferences(storage: StorageLike, prefs: Preferences, key = preferenceKey) { try { storage.setItem(key, JSON.stringify(normalisePreferences(prefs))); return true; } catch { return false; } }
