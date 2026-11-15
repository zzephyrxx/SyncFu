import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { test } from 'node:test';
import { usageScale } from '../src/prototype/usage.ts';
import { compareText } from '../src/desktop/line-diff.ts';
import { defaultSelection,decisionSelection,canConfirm,confirmationBlock,requireProtocol } from '../src/desktop/selection.ts';
import { policyFixtures, conflictPreviewFixture, decisionFixtures, usageFixture } from '../src/generated/policy-fixtures.ts';
import { normalisePreferences,persistPreferences,readPreferences,defaults } from '../src/prototype/preferences.ts';
const policy=policyFixtures[2].state.current;
const task={id:policy.task,peer:policy.endpoints[1].device,local:policy.endpoints[0].grant,remote:policy.endpoints[1].grant,label:'Real task',local_path:'/one',remote_path:'/two'};
const plan={id:'plan',digest:'digest',task,policy:{revision:policy.revision,digest:'policy'},undo_of:null,conflicts:[],resolutions:[],review_notes:[],comparison:{same:0,total:4,issues:[],ignored:0,changes:[{path:'create',action:'create'},{path:'update',action:'update'},{path:'delete',action:'delete'},{path:'conflict',action:'conflict'}]}};
const snapshot=()=>({device:{id:policy.endpoints[0].device},tasks:[task],peers:[{id:task.peer,online:true}],history:[],policy_states:[{task:task.id,state:{current:structuredClone(policy),pending:null,last_receipt:null},paused:false}],paused_all:false});
test('usage axis scales from bytes through gigabytes instead of hiding small syncs',()=>{
  assert.equal(usageScale([]),1024);assert.equal(usageScale([22]),50);assert.equal(usageScale([1]),2);
  assert.equal(usageScale([1024*3]),1024*5);assert.equal(usageScale([1024**3*1.3]),1024**3*2);
  assert.equal(usageScale([NaN,Infinity,-1]),1024);
});

test('desktop refuses a stale native protocol instead of guessing response shapes',()=>{
  assert.doesNotThrow(()=>requireProtocol(5));
  for(const version of [undefined,null,1,2,3,4,6,'5'])assert.throws(()=>requireProtocol(version));
});

test('P2 Rust fixtures preserve preview nulls, explicit choices and precise usage bytes',()=>{
  assert.equal(conflictPreviewFixture.versions[0].entry.bytes,4);
  assert.equal(conflictPreviewFixture.versions[0].text,'<x>\n');
  assert.equal(conflictPreviewFixture.versions[1].entry,null);
  assert.equal(conflictPreviewFixture.versions[1].reason,'missing');
  assert.deepEqual(decisionFixtures.map(d=>d.decision.choice),['use','later','ignore_version']);
  assert.equal(usageFixture.records[0].bytes,'9007199254740993');
  assert.equal(BigInt(usageFixture.records[0].bytes),9007199254740993n);
});

test('bounded line diff aligns insertions and treats markup as plain text',()=>{
  const diff=compareText('a\nb\nc','a\ninserted\nb\nc');
  assert.equal(diff.rows.filter(r=>r.right?.changed).length,1);
  assert.equal(diff.rows.filter(r=>r.left?.changed).length,0);
  assert.equal(diff.rows.find(r=>r.right?.text==='b').left.text,'b');
  assert.equal(compareText('<img src=x onerror=alert(1)>','safe').rows[0].left.text,'<img src=x onerror=alert(1)>');
  assert.equal(compareText('x\n'.repeat(700),'y\n'.repeat(700)).truncated,true);
  assert.ok(compareText('x\n'.repeat(700),'y\n'.repeat(700)).rows.length<=1000);
});

test('manual default selection never silently approves deletes or conflicts',()=>{assert.deepEqual([...defaultSelection(plan)],['create','update']);});
test('undo defaults include safe reverse deletes but not protected later edits',()=>{assert.deepEqual([...defaultSelection({...plan,undo_of:'batch'})],['create','update','delete']);});
test('decision transitions retain prior deselection and explicitly chosen overwrite',()=>{
  const resolved={...plan,comparison:{...plan.comparison,changes:plan.comparison.changes.map(c=>c.path==='conflict'?{...c,action:'update'}:c)}};
  assert.deepEqual([...decisionSelection(resolved,new Set(['create']),[{path:'conflict',decision:{choice:'use',source_device:'a'}}])],['create','conflict']);
  assert.deepEqual([...decisionSelection(plan,new Set(['conflict','create']),[{path:'conflict',decision:{choice:'later'}}])],['create']);
});
test('confirmation rechecks live policy revision, peer, pause and unfinished work',()=>{
  assert.equal(canConfirm(snapshot(),plan,['create']),true);
  const cases=[s=>{s.paused_all=true},s=>{s.policy_states[0].paused=true},s=>{s.policy_states[0].state.current.revision++},s=>{s.policy_states[0].state.pending={}},s=>{s.peers[0].online=false},s=>{s.history.push({status:'pending'})}];
  for(const mutate of cases){const s=snapshot();mutate(s);assert.equal(canConfirm(s,plan,['create']),false);}
  assert.equal(canConfirm(snapshot(),plan,[]),false);assert.equal(canConfirm(snapshot(),{...plan,comparison:{...plan.comparison,issues:['blocked']}},['create']),false);
});
test('partial scan results explain blocked sync without enabling unsafe changes',()=>{
  const partial={...plan,comparison:{...plan.comparison,issues:['Unable to read one directory']}};
  assert.equal(confirmationBlock(snapshot(),partial,['create']),'scanIncomplete');
  assert.equal(canConfirm(snapshot(),partial,['create']),false);
  assert.equal(confirmationBlock(snapshot(),plan,[]),'syncNoSelection');
  const pending=snapshot();pending.policy_states[0].state.pending={};
  assert.equal(confirmationBlock(pending,plan,['create']),'pendingPolicy');
  assert.equal(confirmationBlock(snapshot(),plan,['create']),null);
});
test('production and prototype preferences are isolated by namespace',()=>{
  const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  persistPreferences(storage,{...defaults,locale:'ja'});
  persistPreferences(storage,{...defaults,locale:'en'},'syncfu-desktop:v3:preferences');
  assert.equal(readPreferences(storage).locale,'ja');assert.equal(readPreferences(storage,'syncfu-desktop:v3:preferences').locale,'en');
  assert.deepEqual(normalisePreferences(undefined),defaults);
});
test('desktop controllers never populate real pages with prototype seed data',()=>{
  for(const name of readdirSync(new URL('../src/desktop/',import.meta.url)).filter(n=>/\.tsx?$/.test(n))){
    const source=readFileSync(new URL(`../src/desktop/${name}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(?:makeTasks|seedUsage|previewSnapshot|previewPlan|executeDemo)\b/,name);
  }
  const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
  assert.match(main,/import\.meta\.env\.DEV\s*&&\s*parameters\.has\('desktop-test'\)/);
  assert.match(main,/import\('\.\/desktop\/Desktop'\)/);
});
