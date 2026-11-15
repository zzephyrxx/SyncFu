import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import {collectSources,createManifest,hash,readReleaseMetadata,sourceDirectories,sourceFiles,verifySources} from './release-source.mjs';
import {packageSource,zipSources} from './package-source.mjs';
import {commandInvocation,parseBuildOptions} from './build.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function workspace(t){
  const root=mkdtempSync(join(tmpdir(),'syncfu-release-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const name of sourceDirectories){mkdirSync(join(root,name),{recursive:true});writeFileSync(join(root,name,'fixture.txt'),'source fixture\n');}
  for(const name of sourceFiles)writeFileSync(join(root,name),'test source\n');
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'syncfu',version:'0.1.0'}));
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({version:'0.1.0',packages:{'':{version:'0.1.0'}}}));
  writeFileSync(join(root,'src-tauri/tauri.conf.json'),JSON.stringify({productName:'SyncFu',identifier:'org.syncfu.desktop',version:'0.1.0'}));
  for(const name of ['core/Cargo.toml','src-tauri/Cargo.toml'])writeFileSync(join(root,name),'[package]\nversion = "0.1.0"\n');
  writeFileSync(join(root,'Cargo.lock'),'[[package]]\nname = "syncfu"\nversion = "0.1.0"\n[[package]]\nname = "syncfu-core"\nversion = "0.1.0"\n');
  writeFileSync(join(root,'src/中文资料.txt'),'Unicode source: 数据\n');
  for(const name of ['build.mjs','release-source.mjs'])cpSync(join(project,'scripts',name),join(root,'scripts',name));
  return root;
}

// Independent central-directory reader: exercise extraction without relying on the packer's implementation.
function extractZip(bytes,destination){
  const end=bytes.length-22;assert.equal(bytes.readUInt32LE(end),0x06054b50);
  const count=bytes.readUInt16LE(end+10);let offset=bytes.readUInt32LE(end+16);
  const names=[];
  for(let index=0;index<count;index++){
    assert.equal(bytes.readUInt32LE(offset),0x02014b50);
    assert.equal(bytes.readUInt16LE(offset+8)&0x800,0x800);
    assert.equal(bytes.readUInt16LE(offset+10),8);
    const nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32);
    const name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');
    assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'));
    const local=bytes.readUInt32LE(offset+42);assert.equal(bytes.readUInt32LE(local),0x04034b50);
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    const content=inflateRawSync(bytes.subarray(start,start+bytes.readUInt32LE(offset+20)));
    assert.equal(content.length,bytes.readUInt32LE(offset+24));
    const path=join(destination,...name.split('/'));mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);
    names.push(name);offset+=46+nameLength+extraLength+commentLength;
  }
  assert.equal(offset,end);return names;
}

test('release versions must agree across npm, Tauri and local Rust crates',t=>{
  const root=workspace(t);assert.equal(readReleaseMetadata(root).version,'0.1.0');
  writeFileSync(join(root,'core/Cargo.toml'),'[package]\nversion = "0.2.0"\n');
  assert.throws(()=>readReleaseMetadata(root),/version 0.2.0 differs/);
});

test('source allowlist excludes local data, generated output and historical archives',t=>{
  const root=workspace(t);
  for(const name of ['.git/config','node_modules/dependency.js','target/build.log','releases/old.zip','artifacts/private.txt','docs/archive/old.md','src-tauri/gen/schema.json','src/node_modules/dependency.js','src/.env.local','src/key.pem']){
    mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),'must not ship');
  }
  const sources=collectSources(root);
  assert.ok(sources.some(entry=>entry.name==='src/中文资料.txt'));
  assert.ok(sources.every(entry=>!entry.bytes.includes(Buffer.from('must not ship'))));
  assert.throws(()=>zipSources([{name:'../escape',bytes:Buffer.from('bad')}]),/Unsafe ZIP path/);
});

test('source manifests detect tampering, missing files and unexpected source files',t=>{
  const root=workspace(t),manifest=createManifest(root);
  writeFileSync(join(root,'source-manifest.json'),JSON.stringify(manifest));
  assert.equal(verifySources(root,{requireManifest:true}).sourceId,manifest.sourceId);
  writeFileSync(join(root,'src/unexpected.ts'),'new source');
  assert.throws(()=>verifySources(root),/added or removed/);
  rmSync(join(root,'src/unexpected.ts'));
  writeFileSync(join(root,'src/中文资料.txt'),'tampered');
  assert.throws(()=>verifySources(root),/Source mismatch/);
  rmSync(join(root,'src/中文资料.txt'));
  assert.throws(()=>verifySources(root),/Source mismatch/);
});

test('archive extracts to a portable source tree and verifies without Git or dependencies',t=>{
  const root=workspace(t),result=packageSource(root),bytes=readFileSync(result.output);
  const extracted=join(root,'extracted');mkdirSync(extracted);
  const names=extractZip(bytes,extracted);
  assert.ok(names.includes('SyncFu-0.1.0/source-manifest.json'));
  assert.ok(names.includes('SyncFu-0.1.0/Build-Windows.cmd'));
  assert.equal(readFileSync(join(extracted,'SyncFu-0.1.0/src/中文资料.txt'),'utf8'),'Unicode source: 数据\n');
  const manifest=JSON.parse(readFileSync(join(extracted,'SyncFu-0.1.0/source-manifest.json'),'utf8'));
  for(const [name,expected] of Object.entries(manifest.sha256))assert.equal(hash(readFileSync(join(extracted,'SyncFu-0.1.0',name))),expected);
  const verify=spawnSync(process.execPath,['scripts/build.mjs','windows','--verify-only'],{cwd:join(extracted,'SyncFu-0.1.0'),encoding:'utf8'});
  assert.equal(verify.status,0,verify.stderr);assert.match(verify.stdout,/Verified \d+ files/);
  rmSync(join(extracted,'SyncFu-0.1.0/source-manifest.json'));
  const missing=spawnSync(process.execPath,['scripts/build.mjs','windows','--verify-only'],{cwd:join(extracted,'SyncFu-0.1.0'),encoding:'utf8'});
  assert.equal(missing.status,1);assert.match(missing.stderr,/source-manifest.json is missing/);
  const again=packageSource(root);assert.deepEqual(readFileSync(again.output),bytes,'packaging is deterministic');
});

test('symlinks cannot pull files outside the source package', {skip:process.platform==='win32'}, t=>{
  const root=workspace(t);symlinkSync(join(root,'README.md'),join(root,'src/linked.md'));
  assert.throws(()=>collectSources(root),/Source symlinks/);
});

test('Windows npm invokes cmd explicitly and rejects shell metacharacters',()=>{
  assert.deepEqual(commandInvocation('npm',['run','tauri','--','build'],'win32','C:\\Windows\\cmd.exe'),{command:'C:\\Windows\\cmd.exe',args:['/d','/s','/c','npm.cmd run tauri -- build']});
  assert.throws(()=>commandInvocation('npm',['ci','&whoami'],'win32'),/Unsafe/);
  assert.deepEqual(commandInvocation('cargo',['test'],'win32'),{command:'cargo',args:['test']});
  assert.throws(()=>parseBuildOptions(['linux']),/Usage/);
  assert.throws(()=>parseBuildOptions(['macos','--offline-runtime']),/only to Windows/);
  assert.deepEqual(parseBuildOptions(['windows','--verify-only']),{platform:'windows',verifyOnly:true,offline:false});
});

test('Windows entry point preserves CRLF and a failed build exit status',()=>{
  const cmd=readFileSync(join(project,'Build-Windows.cmd'),'utf8');
  assert.equal(cmd.replaceAll('\r\n','').includes('\n'),false);
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cmd));
  assert.match(cmd,/node scripts\\build\.mjs windows/);
  assert.match(cmd,/set "SYNCFU_BUILD_EXIT=%ERRORLEVEL%"/);
  assert.match(cmd,/exit \/b %SYNCFU_BUILD_EXIT%/);
});
