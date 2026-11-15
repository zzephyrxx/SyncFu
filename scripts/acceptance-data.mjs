import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const suite = 'syncfu-boardui-protocol-4';
export const cases = ['01-bidirectional', '02-one-way-update', '03-mirror', '04-shared'];
const marker = '.syncfu-acceptance.json';
const sha = data => createHash('sha256').update(data).digest('hex');
const text = value => Buffer.from(value, 'utf8');
export function fixtureFiles(side) {
  if (!['mac', 'windows'].includes(side)) throw new Error('side 必须是 mac 或 windows');
  const first = {
    'common.txt': 'Shared baseline v1\n',
    'conflict.txt': side === 'mac' ? 'Mac version - keep this when resolving round 2\n' : 'Windows version - preserve until explicitly resolved\n',
    'preview-guard.txt': 'Preview guard baseline v1\n',
    ...(side === 'mac' ? { 'mac-only.txt': 'Only on Mac initially\n', 'nested/中文 文件.txt': '跨平台中文路径测试\n' } : { 'windows-only.txt': 'Only on Windows initially\n' }),
  };
  const update = side === 'mac' ? { 'master.txt': 'Authoritative Mac content v1\n', 'new/deep.txt': 'New source file\n' } : { 'master.txt': 'Receiver local content - will be backed up\n', 'receiver-only.txt': 'Must survive one-way UPDATE\n' };
  const mirror = { 'keep.txt': 'Mirror shared survivor\n' };
  if (side === 'windows') for (let i = 1; i <= 103; i++) mirror[`待清理/旧稿-${String(i).padStart(3, '0')}.txt`] = `Disposable acceptance file ${i}; restore must preserve these exact bytes.\n`;
  return { '01-bidirectional': first, '02-one-way-update': update, '03-mirror': mirror, '04-shared': side === 'mac' ? { 'owner.txt': 'Shared task owned by the Mac; receiver may pull but not change policy.\n' } : {} };
}
function noLinks(path) {
  for (let p = resolve(path); ; p = dirname(p)) {
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error(`拒绝链接路径：${p}`);
    if (dirname(p) === p) break;
  }
}
export function initialize(root, side) {
  root = resolve(root); noLinks(root);
  if (existsSync(root)) throw new Error('验收目录已存在；不会覆盖或重置。请指定一个新的目录。');
  const files = fixtureFiles(side);
  mkdirSync(dirname(root), { recursive: true }); mkdirSync(root);
  for (const name of cases) {
    mkdirSync(join(root, name));
    for (const [relative, content] of Object.entries(files[name])) {
      const path = join(root, name, ...relative.split('/')); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text(content), { flag: 'wx' });
    }
  }
  writeFileSync(join(root, marker), JSON.stringify({ suite, side, run: randomUUID(), createdAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
  return inspect(root);
}
function identify(root) {
  root = resolve(root); noLinks(root);
  const path = join(root, marker);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) throw new Error('这不是本工具创建的验收目录；不会扫描或写报告。');
  const meta = JSON.parse(readFileSync(path, 'utf8'));
  if (meta.suite !== suite || !['mac', 'windows'].includes(meta.side) || typeof meta.run !== 'string') throw new Error('验收目录标记不匹配。');
  return { root, meta };
}
function scan(path) {
  const files = {}, directories = [], issues = [];
  if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) return { files, directories, issues: ['测试文件夹缺失或变为链接'] };
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['.syncfu-stage', '.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = join(directory, entry.name); const stat = lstatSync(target);
      if (stat.isSymbolicLink()) { issues.push(`链接未读取：${relative}`); continue; }
      if (stat.isDirectory()) { directories.push(relative); walk(target, relative); }
      else if (stat.isFile()) { const bytes = readFileSync(target); files[relative] = { bytes: bytes.length, sha256: sha(bytes) }; }
      else issues.push(`非普通文件未读取：${relative}`);
    }
  };
  walk(path, ''); return { files, directories: directories.sort(), issues };
}
export function inspect(root) {
  const { root: resolved, meta } = identify(root);
  return { suite, side: meta.side, run: meta.run, directory: basename(resolved), checkedAt: new Date().toISOString(), cases: Object.fromEntries(cases.map(name => [name, scan(join(resolved, name))])) };
}
export function expectedFiles(side, stage) {
  const own = fixtureFiles(side), mac = fixtureFiles('mac'), windows = fixtureFiles('windows');
  if (stage === 'initial') return own;
  if (stage === 'bidirectional-unresolved' || stage === 'bidirectional-resolved-mac') return { '01-bidirectional': { ...mac['01-bidirectional'], ...windows['01-bidirectional'], 'conflict.txt': stage === 'bidirectional-resolved-mac' ? mac['01-bidirectional']['conflict.txt'] : own['01-bidirectional']['conflict.txt'] } };
  if (stage === 'one-way-updated') return { '02-one-way-update': side === 'mac' ? mac['02-one-way-update'] : { ...mac['02-one-way-update'], 'receiver-only.txt': windows['02-one-way-update']['receiver-only.txt'] } };
  if (stage === 'mirror-cleared') return { '03-mirror': mac['03-mirror'] };
  if (stage === 'mirror-restored') return { '03-mirror': own['03-mirror'] };
  if (stage === 'shared-synced') return { '04-shared': mac['04-shared'] };
  throw new Error('未知验收阶段；支持 initial、bidirectional-unresolved、bidirectional-resolved-mac、one-way-updated、mirror-cleared、mirror-restored、shared-synced');
}
export function verify(root, stage) {
  const report = inspect(root), expected = expectedFiles(report.side, stage);
  const results = {};
  for (const [name, files] of Object.entries(expected)) {
    const actual = report.cases[name], mismatches = [...actual.issues];
    for (const [path, content] of Object.entries(files)) if (actual.files[path]?.sha256 !== sha(text(content))) mismatches.push(`缺失或内容不符：${path}`);
    for (const path of Object.keys(actual.files)) if (!Object.hasOwn(files, path)) mismatches.push(`非预期文件：${path}`);
    const expectedDirectories = new Set(Object.keys(files).flatMap(path => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
    for (const path of actual.directories) if (!expectedDirectories.has(path)) mismatches.push(`非预期目录：${path}`);
    for (const path of expectedDirectories) if (!actual.directories.includes(path)) mismatches.push(`缺少目录：${path}`);
    results[name] = { pass: mismatches.length === 0, files: Object.keys(actual.files).length, mismatches };
  }
  return { ...report, stage, pass: Object.values(results).every(result => result.pass), results };
}
export function saveReport(root, report) {
  const { root: resolved } = identify(root); const directory = join(resolved, 'reports'); noLinks(directory); mkdirSync(directory, { recursive: true });
  const file = join(directory, `${report.stage ?? 'snapshot'}-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); return file;
}
function main() {
  const [action, ...rest] = process.argv.slice(2); const options = {};
  for (let i = 0; i < rest.length; i += 2) { if (!rest[i]?.startsWith('--') || !rest[i + 1]) throw new Error('参数格式：--root PATH [--side mac|windows] [--stage NAME]'); options[rest[i].slice(2)] = rest[i + 1]; }
  if (!options.root) throw new Error('必须显式指定 --root，且只能使用专用验收目录。');
  let report;
  if (action === 'init') { initialize(options.root, options.side); report = verify(options.root, 'initial'); }
  else if (action === 'check') report = verify(options.root, options.stage ?? 'initial');
  else if (action === 'snapshot') report = inspect(options.root);
  else throw new Error('用法：node scripts/acceptance-data.mjs init|check|snapshot --root PATH [--side mac|windows] [--stage NAME]');
  const file = saveReport(options.root, report);
  console.log(JSON.stringify({ side: report.side, stage: report.stage ?? 'snapshot', pass: report.pass ?? null, results: report.results ?? Object.fromEntries(Object.entries(report.cases).map(([name,v])=>[name,{files:Object.keys(v.files).length,issues:v.issues}])), report: file }, null, 2));
  if (report.pass === false) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
