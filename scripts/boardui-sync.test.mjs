import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clipSelection,groupSelection,inScope,matchingChanges,rowSelectionRecord,selectionFromRecord,toggleGroup} from '../src/desktop/batch-selection.ts';
import {requiresReview,syncAttempt,validatePreview} from '../src/desktop/sync-flow.ts';
const changes=[{path:'send/new.txt',target:1,action:'create'},{path:'receive/update.txt',target:0,action:'update'},{path:'old.txt',target:1,action:'delete'},{path:'conflict.txt',target:0,action:'conflict'},{path:'directory',target:1,action:'create'}];
const plan={id:'p',digest:'d',task:{id:'t'},policy:{revision:1,digest:'policy'},undo_of:null,resolutions:[],comparison:{changes}};
const preview=selected=>({plan:'p',digest:'d',selection_digest:'s',selected,approval_required:false,risks:[]});
test('scope is one-time target selection, never conflict authority',()=>{
  assert.deepEqual([...clipSelection(plan,changes.map(c=>c.path),'send')],['send/new.txt','old.txt','directory']);
  assert.deepEqual([...clipSelection(plan,changes.map(c=>c.path),'receive')],['receive/update.txt']);
  assert.equal(inScope(changes[3],'send'),true);
  assert.equal(matchingChanges(plan,'send','NEW')[0].path,'send/new.txt');
});
test('type selection supports mixed state and all matching pages, preserving unrelated selections',()=>{
  const many=Array.from({length:205},(_,i)=>({path:`page/${i}`,action:'create',target:1}));
  const selected=new Set(['outside',many[0].path]);assert.equal(groupSelection(many,selected).mixed,true);
  const all=toggleGroup(many,selected);assert.equal(all.size,206);assert.equal(groupSelection(many,all).checked,true);
  assert.deepEqual([...toggleGroup(many,all)],['outside']);assert.equal(groupSelection([],new Set()).checked,false);
  assert.equal(toggleGroup([changes[3]],new Set()).size,0);
});
test('row IDs handle duplicate basenames and prototype-named paths safely',()=>{
  const paths=['a/report.txt','b/report.txt','__proto__','constructor','toString'];
  const p={...plan,comparison:{changes:paths.map(path=>({path,action:'create',target:1}))}};
  const record=rowSelectionRecord(new Set(paths));assert.equal(Object.getPrototypeOf(record),null);assert.deepEqual([...selectionFromRecord(record,p,'all')],paths);
  const inherited=Object.create({'path:toString':true});inherited['path:constructor']=true;
  assert.deepEqual([...selectionFromRecord(inherited,p,'all')],['constructor']);
});
test('deletes, selected resolutions, undo, risks and changed selections require review',()=>{
  const selected=new Set(['send/new.txt']);assert.equal(requiresReview(plan,selected,preview([...selected])),false);
  for(const [p,keys,result]of [[plan,new Set(['old.txt']),preview(['old.txt'])],[{...plan,undo_of:'batch'},selected,preview([...selected])],[{...plan,resolutions:[{conflict:{path:'send/new.txt'}}]},selected,preview([...selected])],[plan,selected,{...preview([...selected]),approval_required:true}],[plan,selected,preview(['send/new.txt','directory'])],[plan,selected,preview([])]])assert.equal(requiresReview(p,keys,result),true);
  assert.equal(requiresReview({...plan,resolutions:[{conflict:{path:'unselected'}}]},selected,preview([...selected])),false);
});
test('preview rejects mismatched IDs, digests, duplicate keys and out-of-scope operations',()=>{
  for(const bad of [{...preview(['send/new.txt']),plan:'other'},{...preview(['send/new.txt']),digest:'other'},preview(['send/new.txt','send/new.txt']),preview(['conflict.txt']),preview(['unknown']),preview([])])assert.throws(()=>validatePreview(plan,'all',bad));
  assert.throws(()=>validatePreview(plan,'send',preview(['receive/update.txt'])));
});
function harness(overrides={}){const calls=[];let current=true;return {calls,cancel:()=>{current=false;},options:{plan,selected:new Set(['send/new.txt']),scope:'all',current:()=>current,preview:async selected=>{calls.push('preview');return preview(selected);},refresh:async()=>{calls.push('refresh');},execute:async()=>{calls.push('execute');return {id:'b',status:'completed'};},...overrides}};}
test('ordinary one-click flow previews and executes exactly once with no review',async()=>{
  const h=harness();const result=await syncAttempt(h.options);assert.equal(result.kind,'executed');assert.deepEqual(h.calls,['preview','refresh','execute']);
});
test('danger and explicit preview-only requests never execute before consent',async()=>{
  for(const override of [{selected:new Set(['old.txt'])},{forceReview:true}]){const h=harness(override);const result=await syncAttempt(h.options);assert.equal(result.kind,'review');assert.deepEqual(h.calls,['preview','refresh']);}
});
test('pause or policy invalidation while previewing cancels rather than writing',async()=>{
  const h=harness();h.options.preview=async selected=>{h.calls.push('preview');h.cancel();return preview(selected);};
  assert.equal((await syncAttempt(h.options)).kind,'cancelled');assert.deepEqual(h.calls,['preview']);
  const refreshed=harness();refreshed.options.refresh=async()=>{refreshed.cancel();};assert.equal((await syncAttempt(refreshed.options)).kind,'cancelled');assert.ok(!refreshed.calls.includes('execute'));
});
test('server-added dependencies return a review payload, not an automatic write',async()=>{
  const h=harness({preview:async()=>preview(['send/new.txt','directory'])});const result=await syncAttempt(h.options);assert.equal(result.kind,'review');assert.deepEqual(result.payload.preview.selected,['send/new.txt','directory']);assert.ok(!h.calls.includes('execute'));
});
test('rejected previews and malformed selection do not execute',async()=>{
  const h=harness({preview:async()=>{throw Error('stale content');}});await assert.rejects(()=>syncAttempt(h.options),/stale content/);assert.ok(!h.calls.includes('execute'));
  const invalid=harness({selected:new Set(['conflict.txt'])});await assert.rejects(()=>syncAttempt(invalid.options));assert.deepEqual(invalid.calls,[]);
});
test('captured user selection does not mutate across awaits',async()=>{
  const selected=new Set(['send/new.txt']);const h=harness({selected,preview:async captured=>{selected.add('old.txt');return preview(captured);}});
  assert.equal((await syncAttempt(h.options)).kind,'executed');
});
