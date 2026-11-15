import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const output = 'target/third-party-notices';
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version=1'], { maxBuffer: 32 * 1024 * 1024 }));
const packages = metadata.packages.filter(item => item.source).map(item => ({
  name: item.name, version: item.version, license: item.license || '(see included notices)', folder: dirname(item.manifest_path),
}));
for (const [directory, item] of Object.entries(JSON.parse(readFileSync('package-lock.json', 'utf8')).packages)) {
  if (directory.startsWith('node_modules/') && !item.dev) {
    packages.push({ name: directory.slice('node_modules/'.length), version: item.version, license: item.license || '(see included notices)', folder: directory });
  }
}
mkdirSync(output, { recursive: true });
for (const { name, version, folder } of packages) {
  let entries;
  try { entries = readdirSync(folder, { withFileTypes: true }); } catch { continue; }
  const out = join(output, name.replaceAll('/', '_') + '-' + version);
  for (const item of entries.filter(entry => entry.isFile() && /^(licen[cs]e|copying|copyright|notice|third.party)/i.test(entry.name))) {
    mkdirSync(out, { recursive: true });
    copyFileSync(join(folder, item.name), join(out, basename(item.name)));
  }
}
for (const [source,name] of [['assets/fluent-emoji/LICENSE.txt','Microsoft-Fluent-Emoji'],['assets/streamline/LICENSE-Phosphor.txt','Phosphor-Icons']]) {
  const out=join(output,name);mkdirSync(out,{recursive:true});copyFileSync(source,join(out,'LICENSE.txt'));
}
copyFileSync('assets/fluent-emoji/sources.json',join(output,'Microsoft-Fluent-Emoji','sources.json'));
const shadcnNotices=join(output,'Shadcn-Tauri-UI-sources');mkdirSync(shadcnNotices,{recursive:true});
for(const entry of readdirSync('assets/shadcn-licenses',{withFileTypes:true})){
  if(entry.isFile())copyFileSync(join('assets/shadcn-licenses',entry.name),join(shadcnNotices,entry.name));
}
const materialNotices=join(output,'Material-UI-sources');mkdirSync(materialNotices,{recursive:true});
for(const name of readdirSync('assets/material-licenses'))copyFileSync(join('assets/material-licenses',name),join(materialNotices,name));
const boardNotices=join(output,'BoardUI-sources');mkdirSync(boardNotices,{recursive:true});
for(const name of readdirSync('assets/boardui-licenses'))copyFileSync(join('assets/boardui-licenses',name),join(boardNotices,name));
writeFileSync(join(output, 'DEPENDENCIES.txt'), packages.map(item => `${item.name} ${item.version}: ${item.license}`).sort().join('\n') + '\n');
