import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {test} from 'node:test';
import {captureGlassWithinDeadline} from '../src/desktop/glass/capture-lifecycle.ts';

const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};

test('successful capture settles once and removes its cancellation listener',async()=>{
  const controller=new AbortController(),image={data_url:'pixels'};
  const outcome=await captureGlassWithinDeadline(()=>Promise.resolve(image),{timeoutMs:1000,signal:controller.signal});
  assert.deepEqual(outcome,{status:'captured',value:image});
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
  controller.abort();
  assert.equal(outcome.status,'captured');
});

test('timeout opens a fallback and cannot later publish a delayed snapshot',async()=>{
  const capture=deferred(),controller=new AbortController();
  let publishes=0;
  const pending=captureGlassWithinDeadline(()=>capture.promise,{timeoutMs:5,signal:controller.signal})
    .then(result=>{publishes++;return result;});
  const outcome=await pending;
  assert.deepEqual(outcome,{status:'timed-out'});
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
  capture.resolve({data_url:'late pixels containing a visible popup'});
  await Promise.resolve();
  assert.equal(publishes,1);
  assert.equal(outcome.status,'timed-out');
});

test('closing a popup cancels the pending result and safely consumes a late native rejection',async()=>{
  const capture=deferred(),controller=new AbortController();
  const pending=captureGlassWithinDeadline(()=>capture.promise,{timeoutMs:1000,signal:controller.signal});
  controller.abort();
  assert.deepEqual(await pending,{status:'cancelled'});
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
  capture.reject(new Error('native capture completed after close'));
  await Promise.resolve();
});

test('pre-cancelled, invalid, and exhausted requests never start native capture',async()=>{
  const controller=new AbortController();controller.abort();
  let called=0;
  const capture=async()=>{called++;return 'pixels';};
  assert.equal((await captureGlassWithinDeadline(capture,{timeoutMs:1000,signal:controller.signal})).status,'cancelled');
  assert.equal((await captureGlassWithinDeadline(capture,{timeoutMs:1000,isCurrent:()=>false})).status,'invalidated');
  for(const timeoutMs of [0,-1,NaN,Infinity]) {
    assert.equal((await captureGlassWithinDeadline(capture,{timeoutMs})).status,'timed-out');
  }
  assert.equal(called,0);
});

test('theme, viewport, or generation changes invalidate a capture before publication',async()=>{
  const capture=deferred();let scene='light:1120x780:1';
  const original=scene;
  const pending=captureGlassWithinDeadline(()=>capture.promise,{timeoutMs:1000,isCurrent:()=>scene===original});
  scene='dark:1120x780:1';
  capture.resolve('old light pixels');
  assert.deepEqual(await pending,{status:'invalidated'});
});

test('a newly opened popup may complete after the previous generation was cancelled',async()=>{
  const first=deferred(),second=deferred(),controller=new AbortController();
  const old=captureGlassWithinDeadline(()=>first.promise,{timeoutMs:1000,signal:controller.signal});
  controller.abort();
  const next=captureGlassWithinDeadline(()=>second.promise,{timeoutMs:1000});
  second.resolve('new pixels');
  first.resolve('old pixels');
  assert.equal((await old).status,'cancelled');
  assert.deepEqual(await next,{status:'captured',value:'new pixels'});
});

test('native failures and unsupported capture resolve to an available CSS fallback',async()=>{
  for(const capture of [()=>{throw new Error('bridge unavailable');},()=>Promise.reject(new Error('native failure')),()=>Promise.resolve(null)]) {
    assert.deepEqual(await captureGlassWithinDeadline(capture,{timeoutMs:1000}),{status:'unavailable'});
  }
});
