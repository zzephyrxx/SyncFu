import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { languages, messages, translate, formatBytes } from '../src/prototype/messages.ts';
import { defaults, normalisePreferences, persistPreferences, preferenceKey, readPreferences } from '../src/prototype/preferences.ts';
import { pairingPhase, pairingReducer, initialPairState } from '../src/prototype/pairing.ts';
import { seedUsage, summariseUsage, transferredBytes } from '../src/prototype/usage.ts';
import { shouldAnimate } from '../src/prototype/motion-policy.ts';
import { makeTasks, resolveChange, executeDemo } from '../src/prototype/model.ts';

test('system reduced motion and application settings override visual preferences', () => {
  assert.equal(shouldAnimate('full', true, false), false);
  assert.equal(shouldAnimate('off', false, false), false);
  assert.equal(shouldAnimate('reduced', false, false), false);
  assert.equal(shouldAnimate('full', false, true), false);
  assert.equal(shouldAnimate('full', false, false), true);
});

test('every UI message has five complete translations with matching placeholders', () => {
  assert.equal(Object.keys(languages).length, 5);
  assert.ok(Object.keys(messages).length > 150);
  const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [key, variants] of Object.entries(messages)) {
    assert.equal(variants.length, 5, key);
    for (const value of variants) {
      assert.ok(value.trim(), key);
      assert.deepEqual(placeholders(value), placeholders(variants[0]), key);
    }
  }
});
test('localized interpolation preserves user data and formats counts', () => {
  assert.equal(translate('en', 'riskTitle', { n: 1 }), '1 file would be deleted');
  assert.equal(translate('en', 'riskTitle', { n: 1234 }), '1,234 files would be deleted');
  assert.match(translate('ja', 'selectFile', { path: '研究/foo.md' }), /研究\/foo\.md/);
  assert.match(translate('ko', 'syncDone', { n: 2, pending: 1 }), /2/);
  assert.match(formatBytes(1024, 'en'), /1 KB/);
  assert.equal(formatBytes(-1, 'ja'), '0 B');
});
test('invalid settings cannot enter the preference model', () => {
  const result = normalisePreferences({ locale: '__proto__', theme: 'neon', beginner: 'true', backupDays: -3, backupQuota: Infinity, startup: 'terminal', motion: 'faster' });
  assert.deepEqual(result, defaults);
  assert.equal(normalisePreferences({ locale: 'ja', density: 'compact', beginner: true, backupDays: 3650, backupQuota: 10000 }).locale, 'ja');
  assert.deepEqual(normalisePreferences([]), defaults);
  assert.deepEqual(normalisePreferences(null), defaults);
});
test('preferences are isolated, persistent and safe when storage fails', () => {
  const entries = new Map([['syncfu-theme', 'dark']]);
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const value = { ...defaults, locale: 'ko', beginner: true, motion: 'off' };
  assert.equal(persistPreferences(storage, value), true);
  assert.deepEqual(readPreferences(storage), value);
  assert.equal(entries.get('syncfu-theme'), 'dark');
  assert.equal(entries.has(preferenceKey), true);
  storage.setItem(preferenceKey, '{broken'); assert.deepEqual(readPreferences(storage), defaults);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readPreferences(blocked), defaults);
  assert.equal(persistPreferences(blocked, defaults), false);
});
test('pair codes only become valid after the current generation settles', () => {
  const spinning = pairingReducer(initialPairState, { type: 'generate', generation: 1, code: '12345' });
  assert.equal(spinning.expiresAt, 0);
  assert.equal(spinning.phase, 'spinning');
  assert.equal(pairingReducer(spinning, { type: 'request', now: 100 }), spinning);
  assert.equal(pairingReducer(spinning, { type: 'settle', generation: 0, now: 100 }), spinning);
  const ready = pairingReducer(spinning, { type: 'settle', generation: 1, now: 2000 });
  assert.equal(ready.expiresAt, 62000);
  assert.equal(pairingPhase(ready, 61999), 'ready');
  assert.equal(pairingPhase(ready, 62000), 'expired');
});
test('refresh immediately invalidates old codes and rejects stale callbacks', () => {
  let state = pairingReducer(initialPairState, { type: 'generate', generation: 1, code: '12345' });
  state = pairingReducer(state, { type: 'settle', generation: 1, now: 100 });
  const next = pairingReducer(state, { type: 'generate', generation: 2, code: '67890' });
  assert.equal(next.phase, 'spinning'); assert.equal(next.expiresAt, 0);
  assert.equal(pairingReducer(next, { type: 'settle', generation: 1, now: 200 }), next);
  assert.equal(pairingReducer(next, { type: 'generate', generation: 1, code: '11111' }), next);
});
test('expired requests cannot be accepted, reset invalidates pending work', () => {
  const ready = pairingReducer(pairingReducer(initialPairState, { type: 'generate', generation: 4, code: '00123' }), { type: 'settle', generation: 4, now: 100 });
  const pending = pairingReducer(ready, { type: 'request', now: 200 });
  assert.equal(pending.phase, 'pending');
  assert.equal(pairingReducer(pending, { type: 'approve', now: 60100 }), pending);
  const reset = pairingReducer(pending, { type: 'reset' });
  assert.equal(reset.phase, 'idle'); assert.equal(reset.generation, 4);
  assert.equal(pairingReducer(reset, { type: 'settle', generation: 4, now: 300 }), reset);
  assert.equal(pairingReducer(reset, { type: 'approve', now: 300 }), reset);
});
test('sender validates exactly five digits and supports leading zeroes', () => {
  assert.equal(pairingReducer(initialPairState, { type: 'send', code: 'x1234', now: 0 }), initialPairState);
  const pending = pairingReducer(initialPairState, { type: 'send', code: '00123', now: 10 });
  assert.equal(pending.code, '00123'); assert.equal(pending.phase, 'pending');
  assert.equal(pairingReducer(pending, { type: 'approve', now: 20 }).phase, 'done');
});
test('transferred bytes exclude deletions but include resolved conflict payloads', () => {
  const all = makeTasks()[0].changes;
  const normal = all.filter(c => c.kind === 'create' || c.kind === 'update').reduce((sum, c) => sum + c.size, 0);
  assert.equal(transferredBytes(all), normal);
  assert.equal(transferredBytes(makeTasks()[2].changes), 0);
  const resolved = resolveChange(makeTasks()[0], '笔记/工作交接.md', 'remote');
  assert.equal(transferredBytes(executeDemo(resolved).applied), normal + 2160);
});
test('usage scopes all measures to one range, deduplicates and excludes undo/failure/empty', () => {
  const now = new Date(2026, 10, 12, 16, 0).getTime();
  const event = { id: 'one', createdAt: now, kind: 'sync', status: 'completed', files: 3, bytes: 100 };
  const events = [event, event, { ...event, id: 'undo', kind: 'undo' }, { ...event, id: 'bad', status: 'failed' }, { ...event, id: 'empty', files: 0 }, { ...event, id: 'future', createdAt: now + 1 }, { ...event, id: 'old', createdAt: now - 9 * 86400000 }];
  const report = summariseUsage(events, 7, now);
  assert.equal(report.rows.length, 7); assert.equal(report.syncs, 1); assert.equal(report.files, 3); assert.equal(report.bytes, 100);
  assert.equal(summariseUsage(events, 30, now).syncs, 2);
  assert.equal(report.rows.reduce((sum, r) => sum + r.bytes, 0), report.bytes);
});
test('seed statistics are deterministic records, not fixed aggregate labels', () => {
  const now = new Date(2026, 10, 12, 16, 0).getTime();
  const events = seedUsage(now); const seven = summariseUsage(events, 7, now); const thirty = summariseUsage(events, 30, now);
  assert.ok(thirty.syncs > seven.syncs); assert.ok(seven.bytes > 0);
  assert.deepEqual(events, seedUsage(now));
  const updated = summariseUsage([...events, { id: 'new', createdAt: now, kind: 'sync', status: 'completed', bytes: 1000, files: 2 }], 7, now);
  assert.equal(updated.bytes, seven.bytes + 1000); assert.equal(updated.syncs, seven.syncs + 1);
  assert.equal(summariseUsage([], 7, now).bytes, 0);
});
test('vendored artwork is PNG and its content hashes are recorded', () => {
  const readme = readFileSync(new URL('../assets/prototype/README.md', import.meta.url), 'utf8');
  for (const name of ['file_folder_3d.png', 'laptop_3d.png', 'desktop_computer_3d.png', 'shield_3d.png']) {
    const data = readFileSync(new URL(`../assets/prototype/${name}`, import.meta.url));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.ok(readme.includes(createHash('sha256').update(data).digest('hex')), name);
  }
  assert.match(readFileSync(new URL('../assets/prototype/LICENSE.txt', import.meta.url), 'utf8'), /MIT License/);
});
