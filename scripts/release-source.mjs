import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

export const sourceDirectories=['core','src','src-tauri','scripts','assets','docs','.github'];
export const sourceFiles=['Cargo.toml','Cargo.lock','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','README.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','.gitignore','.gitattributes','.editorconfig','LICENSE','NOTICE','Build-Windows.cmd'];
const excludedDirectories=new Set(['.git','.codex','.agents','.claude','.aws','.ssh','.gnupg','node_modules','target','dist','artifacts','releases','coverage','logs','syncfu-data','test-data']);
const excludedPaths=new Set(['docs/archive','src-tauri/gen']);
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));

export function readReleaseMetadata(root){
  const pkg=readJson(join(root,'package.json'));
  const lock=readJson(join(root,'package-lock.json'));
  const app=readJson(join(root,'src-tauri/tauri.conf.json'));
  if(pkg.name!=='syncfu'||!/^\d+\.\d+\.\d+$/.test(pkg.version))throw new Error('Expected a SyncFu release version such as 0.1.0.');
  if(app.productName!=='SyncFu'||app.identifier!=='org.syncfu.desktop')throw new Error('The release must use the SyncFu application identity.');
  for(const [name,version] of [['Tauri',app.version],['npm lock',lock.version],['npm root package',lock.packages?.['']?.version]]){
    if(version!==pkg.version)throw new Error(`${name} version ${version} differs from ${pkg.version}.`);
  }
  for(const name of ['core/Cargo.toml','src-tauri/Cargo.toml']){
    const packageSection=readFileSync(join(root,name),'utf8').split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
    const version=packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if(version!==pkg.version)throw new Error(`${name} version ${version} differs from ${pkg.version}.`);
  }
  const cargoLock=readFileSync(join(root,'Cargo.lock'),'utf8');
  for(const name of ['syncfu','syncfu-core']){
    const section=cargoLock.split('[[package]]').find(section=>new RegExp(`^name = "${name}"$`,'m').test(section));
    if(section?.match(/^version = "([^"]+)"/m)?.[1]!==pkg.version)throw new Error(`Cargo.lock ${name} version differs from ${pkg.version}.`);
  }
  return {productName:app.productName,version:pkg.version,identifier:app.identifier};
}

export function validSourcePath(name){
  return typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
}

export function collectSources(root){
  const entries=[];
  function walk(name){
    const basename=name.split('/').at(-1);
    if(excludedPaths.has(name)||excludedDirectories.has(basename)||basename==='.DS_Store'||basename==='Thumbs.db'||basename==='Desktop.ini'||/^\.env(?:\.|$)/.test(basename)||/\.(?:key|pem|p12|pfx|sqlite3?|db)(?:-|$)/i.test(basename))return;
    const path=join(root,...name.split('/'));
    const stat=lstatSync(path);
    if(stat.isSymbolicLink())throw new Error(`Source symlinks are not supported: ${name}`);
    if(stat.isDirectory()){
      for(const child of readdirSync(path).sort())walk(`${name}/${child}`);
    }else if(stat.isFile()){
      if(!validSourcePath(name))throw new Error(`Unsafe source path: ${name}`);
      entries.push({name,bytes:readFileSync(path)});
    }else throw new Error(`Unsupported source file: ${name}`);
  }
  for(const name of [...sourceDirectories,...sourceFiles]){
    if(!existsSync(join(root,name)))throw new Error(`Required source is missing: ${name}`);
    walk(name);
  }
  return entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}

export function createManifest(root,entries=collectSources(root)){
  const metadata=readReleaseMetadata(root);
  const sha256=Object.fromEntries(entries.map(({name,bytes})=>[name,hash(bytes)]));
  return {schemaVersion:1,...metadata,sourceId:hash(JSON.stringify(sha256)),hashPurpose:'Source integrity only; not a publisher signature',sha256};
}

export function verifySources(root,{requireManifest=false}={}){
  const metadata=readReleaseMetadata(root);
  const manifestPath=join(root,'source-manifest.json');
  if(!existsSync(manifestPath)){
    if(requireManifest)throw new Error('source-manifest.json is missing. Extract the complete source ZIP.');
    return {metadata,fileCount:0,sourceId:null};
  }
  const manifest=readJson(manifestPath);
  if(manifest.schemaVersion!==1||manifest.version!==metadata.version||manifest.identifier!==metadata.identifier||manifest.productName!==metadata.productName)throw new Error('The source manifest does not match this SyncFu release.');
  if(!manifest.sha256||typeof manifest.sha256!=='object'||Array.isArray(manifest.sha256))throw new Error('Invalid source manifest entries.');
  const entries=Object.entries(manifest.sha256);
  if(entries.length===0)throw new Error('The source manifest is empty.');
  for(const [name,expected] of entries){
    if(!validSourcePath(name)||name==='source-manifest.json'||!/^[a-f0-9]{64}$/.test(expected))throw new Error(`Invalid source manifest entry: ${name}`);
    const path=resolve(root,...name.split('/'));
    if(!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||hash(readFileSync(path))!==expected)throw new Error(`Source mismatch: ${name}. Extract a fresh source ZIP instead of mixing versions.`);
  }
  if(hash(JSON.stringify(manifest.sha256))!==manifest.sourceId)throw new Error('The source manifest checksum is invalid.');
  const actual=collectSources(root);
  if(actual.length!==entries.length||actual.some(({name})=>!Object.hasOwn(manifest.sha256,name)))throw new Error('Source files were added or removed after packaging. Extract a fresh source ZIP.');
  return {metadata,fileCount:entries.length,sourceId:manifest.sourceId};
}
