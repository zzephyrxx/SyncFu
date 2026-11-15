import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProgress,mergeProgress} from '../src/desktop/execution-progress.ts';
const summary={batch:'one',task:'task',total:20001,done:0,transferred_bytes:0,total_bytes:1,current_path:'',current_bytes:0,current_total:0,stage:'apply',running:true};
test('progress uses applied outcomes, preserves completed files and resets between batches',()=>{
  let state=mergeProgress(emptyProgress,{summary,events:[{path:'a',state:'transferred'},{path:'b',state:'waiting'}],cursor:2,more:false});
  assert.equal(state.files.get('a'),'transferred');
  state=mergeProgress(state,{summary:{...summary,done:1},events:[{path:'a',state:'applied'}],cursor:3,more:false});
  state=mergeProgress(state,{summary:{...summary,done:1},events:[{path:'a',state:'transferred'}],cursor:4,more:false});
  assert.equal(state.files.get('a'),'applied');
  assert.equal(mergeProgress(state,{summary,events:[],cursor:2,more:false}),state);
  const fresh=mergeProgress(state,{summary:{...summary,batch:'two'},events:[{path:'b',state:'failed'}],cursor:1,more:false});
  assert.equal(fresh.files.has('a'),false);assert.equal(fresh.files.get('b'),'failed');
});
test('bounded pages accumulate more than 20,000 file outcomes without dropping any',()=>{
  let state=emptyProgress;
  for(let offset=0;offset<20001;offset+=256){const end=Math.min(20001,offset+256);state=mergeProgress(state,{summary:{...summary,done:end},events:Array.from({length:end-offset},(_,i)=>({path:`${offset+i}.txt`,state:'applied'})),cursor:end,more:end<20001},offset>0);}
  assert.equal(state.files.size,20001);assert.equal(state.cursor,20001);assert.equal(state.files.get('20000.txt'),'applied');
});
