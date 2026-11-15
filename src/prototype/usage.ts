import type { DemoChange } from './model.ts';
export interface UsageEvent { id: string; createdAt: number; kind: 'sync' | 'undo'; status: 'completed' | 'failed' | 'cancelled'; files: number; bytes: number }
export function transferredBytes(changes: DemoChange[]) {
  return changes.reduce((sum, c) => sum + (c.kind !== 'delete' && (c.kind !== 'conflict' || c.resolution === 'local' || c.resolution === 'remote') ? c.size : 0), 0);
}
export function seedUsage(now = Date.now()): UsageEvent[] {
  const records: UsageEvent[] = [];
  for (let day = 0; day < 30; day++) {
    const date = new Date(now); date.setDate(date.getDate() - day); date.setHours(8, 15, 0, 0);
    for (let batch = 0; batch < day % 3 + 1; batch++) {
      const createdAt = date.getTime() + batch * 2400000;
      if (createdAt <= now) records.push({ id: `sample-${day}-${batch}`, createdAt, kind: 'sync', status: 'completed', files: 9 + (day * 13 + batch) % 87, bytes: (day % 7 + 1) * 135000000 + batch * 912000 });
    }
  }
  return records;
}
export function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function usageScale(values: number[]) {
  const largest = Math.max(0,...values.filter(Number.isFinite));
  if(largest===0)return 1024;
  const unit=1024**Math.max(0,Math.floor(Math.log(largest)/Math.log(1024)));
  const steps=unit===1?[2,4,10,20,50,100,200,500,1024]:[1,2,5,10,20,50,100,200,500,1024];
  const step=steps.find(value=>value>=largest/unit)??1024;
  return step*unit;
}
export function summariseUsage(events: UsageEvent[], days: 7 | 30, now = Date.now()) {
  const start = new Date(now); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
  const rows = Array.from({ length: days }, (_, i) => { const date = new Date(start); date.setDate(date.getDate() + i); return { key: dayKey(date), timestamp: date.getTime(), bytes: 0, files: 0, syncs: 0 }; });
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id) || event.kind !== 'sync' || event.status !== 'completed' || event.files <= 0 || event.createdAt < start.getTime() || event.createdAt > now) continue;
    seen.add(event.id);
    const row = rows.find(r => r.key === dayKey(new Date(event.createdAt))); if (!row) continue;
    row.syncs++; row.files += event.files; row.bytes += Math.max(0, event.bytes);
  }
  return { rows, syncs: rows.reduce((s, r) => s + r.syncs, 0), files: rows.reduce((s, r) => s + r.files, 0), bytes: rows.reduce((s, r) => s + r.bytes, 0) };
}
