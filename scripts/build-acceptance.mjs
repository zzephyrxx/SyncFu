import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const platform=process.argv[2];const verifyOnly=process.argv.includes('--verify-only');const offline=process.argv.includes('--offline-runtime');
function run(command,args){
  console.log(`\n> ${command} ${args.join(' ')}`);
  const options={cwd:root,stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:join(root,'target')}};
  const result=process.platform==='win32'&&command==='npm'
    ?spawnSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c',`npm.cmd ${args.join(' ')}`],options)
    :spawnSync(command,args,options);
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed (${result.status ?? result.signal}). Stop here; do not use an old installer.`);
}
function verify(){
  if(!['windows','macos'].includes(platform))throw new Error('Usage: node scripts/build-acceptance.mjs windows|macos [--verify-only]');
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<18))throw new Error('Node.js 22.18+ is required for the TypeScript contract tests.');
  const sourcePath=join(root,'docs','acceptance','source-manifest.json');
  if(!existsSync(sourcePath))throw new Error('The acceptance source manifest is missing. Use the complete acceptance source bundle.');
  const source=JSON.parse(readFileSync(sourcePath,'utf8'));
  if(source.protocol!==4||source.identifier!=='org.syncfu.acceptance.p2')throw new Error('Wrong acceptance manifest.');
  let checked=0;
  for(const [name,expected] of Object.entries(source.sha256)){
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..'))throw new Error('Unsafe manifest path.');
    const path=join(root,...name.split('/'));
    if(!existsSync(path)||createHash('sha256').update(readFileSync(path)).digest('hex')!==expected)throw new Error(`Source mismatch: ${name}. Do not mix or edit files during acceptance.`);
    checked++;
  }
  const config=JSON.parse(readFileSync(join(root,'src-tauri',`tauri.acceptance.${platform}.json`),'utf8'));
  if(config.identifier!==source.identifier||config.productName!=='SyncFu Acceptance'||config.version!=='0.2.0-board.1')throw new Error('Acceptance configuration is not isolated from the normal app.');
  console.log(`Verified ${checked} source files. Acceptance build ID: ${source.buildId}`);
  console.log('Application: SyncFu Acceptance / protocol 4 / separate application data.');
  return source;
}
try{
  const source=verify();
  if(!verifyOnly){
    if((platform==='windows'&&process.platform!=='win32')||(platform==='macos'&&process.platform!=='darwin'))throw new Error(`Build ${platform} on that operating system; this script will not cross-build an unsupported installer.`);
    if(offline&&platform!=='windows')throw new Error('--offline-runtime applies only to Windows.');
    console.log(offline?'Bundling the full offline WebView2 runtime. Expect a large installer.':'Lightweight installer: WebView2 is downloaded only if missing on Windows.');
    run('cargo',['fetch','--locked']);
    run('rustc',['--version']);run('cargo',['--version']);run('npm',['ci']);
    run('cargo',['test','--locked','-p','syncfu-core']);
    run('cargo',['run','--locked','-p','syncfu-core','--features','bindings','--example','export_policy_contract','--','--check']);
    run('npm',['test']);
    run('npm',['run','tauri','--','build','--target',platform==='windows'?'x86_64-pc-windows-msvc':'universal-apple-darwin','--bundles',platform==='windows'?'nsis':'app','--config',`src-tauri/tauri.acceptance.${platform}.json`,...(offline?['--config','src-tauri/tauri.offline.json']:[]),'--ci','--','--locked']);
    if(platform==='macos'){
      const app=join(root,'target','universal-apple-darwin','release','bundle','macos','SyncFu Acceptance.app');
      if(!existsSync(app))throw new Error('Expected acceptance app bundle was not produced.');
      run('codesign',['--force','--deep','--sign','-',app]);
      run('codesign',['--verify','--deep','--strict',app]);
      console.log('Local ad-hoc signature only; this is not Developer ID signing or notarization.');
    }
    verify();
    console.log(`\nAcceptance build ${source.buildId} completed. This is a build result, NOT a two-device test pass.`);
    console.log(platform==='windows'?'Installer: target\\x86_64-pc-windows-msvc\\release\\bundle\\nsis\\':'App: target/universal-apple-darwin/release/bundle/macos/SyncFu Acceptance.app');
    console.log('Quit older SyncFu processes before opening this build. Use only dedicated acceptance folders.');
  }
}catch(error){console.error(`\nACCEPTANCE BUILD STOPPED: ${error.message}`);console.error('If Cargo reports an unavailable localhost proxy or mirror, check your Cargo/user proxy configuration and connectivity. No global proxy settings were changed. Do not disable TLS checks or use an older installer.');process.exitCode=1;}
