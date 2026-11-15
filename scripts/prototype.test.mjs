import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { canManage, canResolve, chosenChanges, executeDemo, isIgnored, isPending, makeTasks, managedChanges, resolveChange, restoreDemo, statusOf, targetOf } from '../src/prototype/model.ts';

const conflictPath = '笔记/工作交接.md';
test('prototype modules contain no network, filesystem, or production command imports', () => {
  for (const name of readdirSync(new URL('../src/prototype/', import.meta.url))) {
    if (!/\.tsx?$/.test(name)) continue;
    const source = readFileSync(new URL(`../src/prototype/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:\/api|@tauri-apps|node:)|\b(?:fetch|invoke|WebSocket|XMLHttpRequest|showDirectoryPicker)\s*\(/);
  }
  const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(entry, /prototypeMode\s*\?\s*import\('\.\/prototype\/Prototype'\)/);
  assert.match(entry, /parameters\.has\('preview'\)\s*\?\s*import\('\.\/App'\)/);
  assert.match(entry, /import\.meta\.env\.DEV\s*&&\s*parameters\.has\('desktop-test'\)/);
  assert.match(entry, /import\('\.\/desktop\/Desktop'\)/);
});
test('initial selection excludes destructive deletes and unresolved conflicts', () => {
  const task = makeTasks()[0];
  assert.equal(task.changes.filter(isPending).length, 2);
  assert.equal(chosenChanges(task).length, 5);
  assert.ok(chosenChanges(task).every(c => c.kind !== 'delete' && c.kind !== 'conflict'));
});
test('resolving with local content targets the remote, not the source', () => {
  const task = resolveChange(makeTasks()[0], conflictPath, 'local');
  const change = task.changes.find(c => c.path === conflictPath);
  assert.equal(change.target, 'remote');
  assert.equal(change.selected, true);
  assert.equal(isPending(change), false);
});
test('postpone, ignore a version, and exclude a path remain distinct', () => {
  for (const resolution of ['later', 'version', 'exclude']) {
    const task = resolveChange(makeTasks()[0], conflictPath, resolution);
    const change = task.changes.find(c => c.path === conflictPath);
    assert.equal(change.selected, false);
    assert.equal(isPending(change), resolution === 'later');
    assert.equal(isIgnored(change), resolution !== 'later');
    assert.equal(change.resolution, resolution);
  }
});
test('single-direction tasks reject a reverse conflict decision', () => {
  const task = { ...makeTasks()[0], mode: 'update', source: 'local' };
  assert.equal(canResolve(task, 'remote'), false);
  assert.equal(resolveChange(task, conflictPath, 'remote'), task);
  assert.equal(canResolve(task, 'local'), true);
});
test('single update preserves destination extras; mirror includes deletion', () => {
  const task = makeTasks()[2];
  assert.equal(managedChanges(task).length, 103);
  const update = { ...task, mode: 'update', risk: false, changes: task.changes.map(c => ({ ...c, selected: true })) };
  assert.equal(managedChanges(update).length, 0);
  assert.equal(chosenChanges(update).length, 0);
  assert.equal(statusOf(update), '文件已一致');
});
test('source device selection determines one-way transfer targets', () => {
  const task = { ...makeTasks()[0], mode: 'update', source: 'remote' };
  for (const c of chosenChanges(task)) assert.equal(targetOf(task, c), 'local');
  assert.ok(executeDemo(task).applied.every(c => c.target === 'local'));
});
test('shared receivers cannot change policy or choose conflicting versions', () => {
  const task = makeTasks('shared')[0];
  assert.equal(canManage(task), false);
  for (const resolution of ['local', 'remote', 'later', 'version', 'exclude']) assert.equal(canResolve(task, resolution), false);
});
test('offline, paused, risk, and permission states cannot execute', () => {
  const task = makeTasks()[0];
  for (const override of [{ online: false }, { paused: true }, { risk: true }, { problem: 'permission' }, { problem: 'partial' }]) {
    const blocked = { ...task, ...override };
    assert.equal(executeDemo(blocked).applied.length, 0);
  }
});
test('executing selected normal files does not mark conflicts completed', () => {
  const before = makeTasks()[0];
  const { task, applied } = executeDemo(before);
  assert.equal(applied.length, 5);
  assert.equal(task.changes.filter(isPending).length, 2);
  assert.equal(task.changes.filter(c => c.kind === 'delete').length, 1);
  assert.equal(before.changes.length, 8, 'source sample is immutable');
});
test('undo demonstration restores selected items and keeps automatic task paused', () => {
  const before = makeTasks()[0];
  const result = executeDemo(before);
  const restored = restoreDemo(result.task, result.applied);
  assert.equal(restored.paused, true);
  assert.equal(restored.automatic, true);
  assert.equal(restored.changes.length, before.changes.length);
  assert.equal(executeDemo(restored).applied.length, 0);
});
test('scenario samples cover all requested non-happy paths', () => {
  assert.equal(makeTasks('empty').length, 0);
  assert.equal(makeTasks('clean')[0].changes.length, 0);
  assert.equal(makeTasks('offline')[0].online, false);
  assert.equal(makeTasks('permission')[0].problem, 'permission');
  assert.equal(makeTasks('partial')[0].problem, 'partial');
});
