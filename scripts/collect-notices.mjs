import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
rmSync(output, { recursive: true, force: true });
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
const fluentNotices=join(output,'Microsoft-Fluent-Emoji');mkdirSync(fluentNotices,{recursive:true});
copyFileSync('assets/fluent-emoji/LICENSE.txt',join(fluentNotices,'LICENSE.txt'));
copyFileSync('assets/fluent-emoji/sources.json',join(fluentNotices,'sources.json'));
cpSync('assets/licenses',join(output,'UI-and-assets'),{recursive:true});
writeFileSync(join(output, 'DEPENDENCIES.txt'), packages.map(item => `${item.name} ${item.version}: ${item.license}`).sort().join('\n') + '\n');
