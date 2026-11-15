import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialize, inspect, verify, fixtureFiles, expectedFiles, saveReport } from './test-data.mjs';

function temp(t) { const root=realpathSync(mkdtempSync(join(tmpdir(),'syncfu-acceptance-test-')));t.after(()=>rmSync(root,{recursive:true,force:true}));return root; }
test('both fresh sides match the initial fixture and never overwrite an existing directory',t=>{
  const parent=temp(t);for(const side of ['mac','windows']){const root=join(parent,side);initialize(root,side);assert.equal(verify(root,'initial').pass,true);assert.throws(()=>initialize(root,side),/已存在/);}
});
test('check reports content modifications without changing any files',t=>{
  const parent=temp(t),root=join(parent,'mac');initialize(root,'mac');const file=join(root,'01-bidirectional','common.txt');writeFileSync(file,'edited');
  const result=verify(root,'initial');assert.equal(result.pass,false);assert.ok(result.results['01-bidirectional'].mismatches.length);assert.equal(readFileSync(file,'utf8'),'edited');
  assert.ok(saveReport(root,result).endsWith('.json'));
});
test('mirror verification includes 103 files and detects an undeleted empty parent',t=>{
  const parent=temp(t),root=join(parent,'windows');initialize(root,'windows');assert.equal(Object.keys(fixtureFiles('windows')['03-mirror']).length,104);
  rmSync(join(root,'03-mirror','待清理'),{recursive:true});assert.equal(verify(root,'mirror-cleared').pass,true);
  mkdirSync(join(root,'03-mirror','待清理'));assert.equal(verify(root,'mirror-cleared').pass,false);
});
test('one-way expected state preserves receiver extras but does not send them to the source',()=>{
  assert.ok(Object.hasOwn(expectedFiles('windows','one-way-updated')['02-one-way-update'],'receiver-only.txt'));
  assert.ok(!Object.hasOwn(expectedFiles('mac','one-way-updated')['02-one-way-update'],'receiver-only.txt'));
});
test('bidirectional expected states distinguish unresolved from selected Mac content',()=>{
  assert.notEqual(expectedFiles('mac','bidirectional-unresolved')['01-bidirectional']['conflict.txt'],expectedFiles('windows','bidirectional-unresolved')['01-bidirectional']['conflict.txt']);
  assert.equal(expectedFiles('mac','bidirectional-resolved-mac')['01-bidirectional']['conflict.txt'],expectedFiles('windows','bidirectional-resolved-mac')['01-bidirectional']['conflict.txt']);
});
test('runtime stage metadata is ignored but unexpected user files are reported',t=>{
  const root=join(temp(t),'mac');initialize(root,'mac');mkdirSync(join(root,'01-bidirectional','.syncfu-stage'));writeFileSync(join(root,'01-bidirectional','.syncfu-stage','grant-test'),'marker');assert.equal(verify(root,'initial').pass,true);
  writeFileSync(join(root,'01-bidirectional','unexpected.txt'),'unexpected');assert.equal(verify(root,'initial').pass,false);
});
test('unmarked folders and links cannot be used as acceptance roots',t=>{
  const parent=temp(t);assert.throws(()=>inspect(parent),/不是/);const root=join(parent,'mac');initialize(root,'mac');
  if(process.platform!=='win32'){const alias=join(parent,'alias');symlinkSync(root,alias);assert.throws(()=>inspect(alias),/链接/);const outside=join(parent,'outside.txt');writeFileSync(outside,'keep');symlinkSync(outside,join(root,'01-bidirectional','link'));assert.equal(verify(root,'initial').pass,false);assert.equal(readFileSync(outside,'utf8'),'keep');}
});
