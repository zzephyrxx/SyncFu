import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { policyCommands } from '../src/generated/policy.ts';
import { policyFixtures, executionFixture, directionFixtures, trustFixtures } from '../src/generated/policy-fixtures.ts';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

test('real Rust serialization preserves required nullability and policy identity', () => {
  assert.equal(policyFixtures.length, 3);
  for (const view of policyFixtures) {
    const p = view.state.current;
    assert.equal(view.task, p.task);
    assert.equal(p.endpoints.length, 2);
    assert.ok(p.endpoints[0].device < p.endpoints[1].device);
    assert.equal(p.task, hash(p.endpoints.map(e => e.grant).sort()));
    assert.ok(Object.hasOwn(view.state, 'pending'));
    assert.ok(Object.hasOwn(view.state, 'last_receipt'));
  }
  assert.equal(policyFixtures[0].state.pending, null);
  assert.equal(policyFixtures[0].state.last_receipt, null);
  assert.equal(policyFixtures[0].state.current.trust.kind, 'unclassified');
  assert.equal(policyFixtures[1].state.pending.accepted, false);
  assert.equal(policyFixtures[2].paused, true);
});
test('Rust proposal digests are compatible with canonical serialized fixtures', () => {
  const proposal = policyFixtures[1].state.pending.proposal;
  const receipt = policyFixtures[2].state.last_receipt;
  assert.equal(receipt.proposal, proposal.id);
  assert.equal(receipt.digest, hash(proposal));
});
test('all public direction and trust discriminants survive serialization', () => {
  assert.deepEqual(directionFixtures.map(d => d.mode), ['bidirectional', 'one_way_update', 'one_way_mirror']);
  assert.deepEqual(trustFixtures.map(t => t.kind), ['unclassified', 'personal', 'shared']);
  assert.equal(executionFixture.approval_required, true);
  assert.deepEqual(executionFixture.risks[0].reasons, ['large_deletion', 'relative_deletion']);
  assert.equal(executionFixture.risks[0].planned_deletions, 103);
  assert.equal(executionFixture.risks[0].selected_deletions, 9);
});
test('every generated command is implemented, registered and used by the typed facade', () => {
  const native = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const handler = native.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(handler, 'missing Tauri handler list');
  const facade = readFileSync(new URL('../src/policy-api.ts', import.meta.url), 'utf8');
  for (const [key, command] of Object.entries(policyCommands)) {
    assert.match(native, new RegExp('fn\\s+' + command + '\\s*\\('), command);
    assert.match(handler, new RegExp('\\b' + command + '\\b'), command);
    assert.ok(facade.includes(`policyCommands.${key}`), key);
  }
  assert.match(native, /approve_risk\.unwrap_or\(false\)/);
  assert.match(facade, /approveRisk\s*=\s*false/);
});
