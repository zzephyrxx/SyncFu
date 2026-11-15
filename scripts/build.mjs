import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,verifySources} from './release-source.mjs';

export function commandInvocation(command,args,platform=process.platform,comspec=process.env.ComSpec??'cmd.exe'){
  if(platform==='win32'&&command==='npm'){
    // Only script-owned tokens reach cmd.exe. Paths/caller input never enter its command string.
    if(args.some(value=>!/^[A-Za-z0-9_.:/@+=-]+$/.test(value)))throw new Error('Unsafe npm command argument.');
    return {command:comspec,args:['/d','/s','/c',`npm.cmd ${args.join(' ')}`]};
  }
  return {command,args};
}

export function parseBuildOptions(args){
  const [platform,...flags]=args;
  if(!['windows','macos'].includes(platform)||flags.some(flag=>!['--verify-only','--offline-runtime'].includes(flag)))throw new Error('Usage: node scripts/build.mjs windows|macos [--verify-only] [--offline-runtime]');
  if(flags.includes('--offline-runtime')&&platform!=='windows')throw new Error('--offline-runtime applies only to Windows.');
  return {platform,verifyOnly:flags.includes('--verify-only'),offline:flags.includes('--offline-runtime')};
}

export function build(root,args){
  const {platform,verifyOnly,offline}=parseBuildOptions(args);
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<18))throw new Error('Node.js 22.18 or newer is required.');
  const result=verifySources(root,{requireManifest:!existsSync(join(root,'.git'))});
  const {version}=result.metadata;
  console.log(`SyncFu ${version} / ${result.metadata.identifier}`);
  console.log(result.sourceId?`Verified ${result.fileCount} files. Source ID: ${result.sourceId}`:'Development checkout: application versions verified; no packaged source manifest.');
  if(verifyOnly)return;
  if((platform==='windows'&&process.platform!=='win32')||(platform==='macos'&&process.platform!=='darwin'))throw new Error(`Build ${platform} on that operating system. --verify-only works on either platform.`);
  const arch=platform==='windows'?'x64':process.arch;
  if(!['arm64','x64'].includes(arch))throw new Error(`Unsupported architecture: ${arch}`);
  const target=platform==='windows'?'x86_64-pc-windows-msvc':arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin';
  function run(command,args){
    console.log(`\n> ${command} ${args.join(' ')}`);
    const invocation=commandInvocation(command,args);
    const status=spawnSync(invocation.command,invocation.args,{cwd:root,stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:join(root,'target')}});
    if(status.error)throw new Error(`Cannot run ${command}: ${status.error.message}. Check the prerequisites in README.md.`);
    if(status.status!==0)throw new Error(`${command} failed (${status.status??status.signal}). Do not use an older installer as this build.`);
  }
  console.log(platform==='windows'?'Windows prerequisites: Rust MSVC toolchain, Visual Studio C++ Build Tools and Windows SDK.':'macOS prerequisite: Xcode Command Line Tools.');
  console.log(offline?'The installer includes the offline WebView2 runtime; downloading build dependencies still requires internet.':'Windows downloads WebView2 during installation only when it is missing. Build dependencies require internet.');
  run('rustc',['--version']);run('cargo',['--version']);run('npm',['--version']);run('rustup',['target','add',target]);
  run('cargo',['fetch','--locked']);run('npm',['ci']);
  run('cargo',['test','--locked','-p','syncfu-core']);
  run('cargo',['run','--locked','-p','syncfu-core','--features','bindings','--example','export_policy_contract','--','--check']);
  run('npm',['test']);
  const configs=platform==='macos'?['--config','src-tauri/tauri.macos.conf.json']:[];
  if(offline)configs.push('--config','src-tauri/tauri.offline.json');
  run('npm',['run','tauri','--','build','--target',target,'--bundles',platform==='windows'?'nsis':'app',...configs,'--ci','--','--locked']);
  verifySources(root);
  const outputDirectory=join(root,'releases',version);mkdirSync(outputDirectory,{recursive:true});
  let output;
  if(platform==='windows'){
    const installer=join(root,'target',target,'release','bundle','nsis',`SyncFu_${version}_x64-setup.exe`);
    if(!existsSync(installer))throw new Error(`Expected installer was not produced: ${installer}`);
    output=join(outputDirectory,`SyncFu-${version}-windows-x64-setup.exe`);copyFileSync(installer,output);
  }else{
    const app=join(root,'target',target,'release','bundle','macos','SyncFu.app');
    if(!existsSync(app))throw new Error(`Expected application was not produced: ${app}`);
    run('codesign',['--force','--deep','--sign','-',app]);run('codesign',['--verify','--deep','--strict',app]);
    output=join(outputDirectory,`SyncFu-${version}-macos-${arch}.zip`);
    run('ditto',['-c','-k','--sequesterRsrc','--keepParent',app,output]);
    console.log('Local ad-hoc signature only; no Developer ID signing or Apple notarization.');
  }
  writeFileSync(`${output}.sha256`,`${hash(readFileSync(output))}  ${output.split(/[\\/]/).at(-1)}\n`);
  console.log(`\nSyncFu ${version} built successfully:\n${output}`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{build(resolve(dirname(fileURLToPath(import.meta.url)),'..'),process.argv.slice(2));}
  catch(error){console.error(`\nBUILD STOPPED: ${error.message}`);process.exitCode=1;}
}
