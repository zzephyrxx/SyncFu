import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const entries={};
const skip=new Set(['src-tauri/gen','docs/acceptance/source-manifest.json','docs/acceptance/results.json','docs/design-streamline/SyncFu-Focused-Transfer.figcraft','docs/design-streamline/document-outline.json','docs/design-streamline/core-light.png','docs/design-streamline/core-dark.png','docs/design-streamline/conflict-light.png','scripts/figcraft-design.py']);
function walk(path){
  const name=relative(root,path).replaceAll('\\','/');
  if(skip.has(name)||name.endsWith('.DS_Store'))return;
  const stat=lstatSync(path);if(stat.isSymbolicLink())throw new Error(`Source symlink refused: ${name}`);
  if(stat.isDirectory()){for(const child of readdirSync(path).sort())walk(join(path,child));}
  else if(stat.isFile())entries[name]=hash(readFileSync(path));
}
for(const name of ['core','src','src-tauri','scripts','assets','docs','.github','Cargo.toml','Cargo.lock','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','README.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','.gitignore','.gitattributes','.editorconfig','LICENSE','NOTICE','Build-Windows-Acceptance.cmd'])walk(join(root,name));
const sha256=Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b,'en')));
const buildId=hash(JSON.stringify(sha256)).slice(0,20);
const manifest={buildId,protocol:4,schema:3,identifier:'org.syncfu.acceptance.p2',productName:'SyncFu Acceptance',version:'0.2.0-board.1',createdAt:new Date().toISOString(),hashPurpose:'Cross-device source consistency, not a publisher signature',sha256};
writeFileSync(join(root,'docs/acceptance/source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Source build ${buildId}: ${Object.keys(sha256).length} files`);
