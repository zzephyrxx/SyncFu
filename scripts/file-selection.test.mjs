import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileIdentity,fileKind,nextDirection,directionNeedsConfirmation,recheckSelection} from '../src/desktop/focus-model.ts';
import {policyFixtures} from '../src/generated/policy-fixtures.ts';
const policy=structuredClone(policyFixtures[2].state.current);
const source=policy.endpoints[0].device,other=policy.endpoints[1].device;
test('file identity separates filename from parent without losing the full key',()=>{
  assert.deepEqual(fileIdentity('设计/导出/logo.svg'),{name:'logo.svg',parent:'设计/导出',full:'设计/导出/logo.svg'});
  assert.equal(fileIdentity('D:\\工作\\readme.md').parent,'D:/工作');
  assert.equal(fileIdentity('a/report.pdf').name,fileIdentity('b/report.pdf').name);
  assert.notEqual(fileIdentity('a/report.pdf').full,fileIdentity('b/report.pdf').full);
  assert.equal(fileIdentity('file').parent,'');
});
test('local glyph classification is deterministic and directories take priority',()=>{
  assert.equal(fileKind('FILE.PDF'),'pdf');assert.equal(fileKind('Logo.SVG'),'image');assert.equal(fileKind('core.rs'),'code');assert.equal(fileKind('notes.md'),'text');assert.equal(fileKind('dir.pdf',true),'folder');
});
test('quick direction preserves authority, exclusions and endpoints',()=>{
  const p={...policy,excludes:['private'],direction:{mode:'bidirectional'},conflicts:{kind:'prefer_device',device:other}};
  const next=nextDirection(p,'one_way_update',source);
  assert.equal(next.revision,p.revision+1);assert.deepEqual(next.trust,p.trust);assert.deepEqual(next.endpoints,p.endpoints);assert.deepEqual(next.excludes,p.excludes);assert.deepEqual(next.conflicts,{kind:'hold'});
  assert.throws(()=>nextDirection(p,'one_way_update','not-an-endpoint'));
  assert.throws(()=>nextDirection({...p,revision:0xffffffff},'bidirectional',source));
});
test('ordinary direction switching is direct but mirror and source reversal require review',()=>{
  const p={...policy,direction:{mode:'bidirectional'}};
  const forward=nextDirection(p,'one_way_update',source),reverse=nextDirection(forward,'one_way_update',other);
  assert.equal(directionNeedsConfirmation(p,forward),false);
  assert.equal(directionNeedsConfirmation(forward,reverse),true);
  assert.equal(directionNeedsConfirmation(forward,nextDirection(forward,'bidirectional',source)),false);
  assert.equal(directionNeedsConfirmation(p,nextDirection(p,'one_way_mirror',source)),true);
});
const entry={type:'file',bytes:5,sha256:'a'.repeat(64)};
const plan={task:{id:'task'},policy:{digest:'p'},undo_of:null,comparison:{changes:[{path:'new.md',action:'create',after:entry},{path:'old.md',action:'delete',before:entry,after:null},{path:'conflict',action:'conflict'}]}};
test('automatic read-only recheck retains deselection without approving new deletes',()=>{
  assert.deepEqual([...recheckSelection(plan,null)],['new.md']);
  assert.deepEqual([...recheckSelection(plan,{plan,selected:new Set(['old.md'])})],['old.md']);
  assert.deepEqual([...recheckSelection({...plan,policy:{digest:'changed'}},{plan,selected:new Set(['old.md'])})],[]);
  const changed={...plan,comparison:{changes:plan.comparison.changes.map(ch=>ch.path==='old.md'?{...ch,before:{...entry,bytes:9}}:ch)}};
  assert.deepEqual([...recheckSelection(changed,{plan,selected:new Set(['old.md'])})],[]);
  assert.deepEqual([...recheckSelection({...plan,task:{id:'another'}},{plan,selected:new Set(['old.md'])})],['new.md']);
});
