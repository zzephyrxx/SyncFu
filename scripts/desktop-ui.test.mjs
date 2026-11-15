import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('the original user logo and native icons are byte-for-byte preserved',()=>{
  const checkpoint=JSON.parse(read('assets/logo-checkpoint.json'));
  for(const [file,expected] of Object.entries(checkpoint))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),expected,file);
  assert.match(read('src/desktop/Desktop.tsx'),/assets\/syncfu-icon\.svg/);assert.match(read('src/desktop/Desktop.tsx'),/src=\{logo\}/);
});
test('production styles use solid neutral surfaces without gradients or glass effects',()=>{
  for(const file of ['src/desktop/ui/index.css','src/components/ui/tokens.css','src/components/ui/primitives.css','src/desktop/workspace.css']){
    const css=read(file);assert.doesNotMatch(css,/(?:linear|radial|conic)-gradient\s*\(/i);assert.doesNotMatch(css,/backdrop-filter/);
  }
  assert.match(read('src/desktop/ui/index.css'),/source\(none\)/);
});
test('the live desktop uses shadcn primitives without the old visual kits or a material chooser',()=>{
  const desktop=read('src/desktop/Desktop.tsx'),settings=read('src/desktop/LiveSettings.tsx');
  assert.match(desktop,/components\/ui\/primitives\.css/);assert.doesNotMatch(desktop,/design-system\//);assert.doesNotMatch(settings,/MaterialPicker|materialTheme|materialNeo|materialLiquid/);
  for(const file of ['src/desktop/ui/UI.tsx','src/desktop/ui/SyncChangesTable.tsx','src/desktop/LiveDialogs.tsx'])assert.doesNotMatch(read(file),/from ['"][^'"]*(?:vendor\/|react-aria-components|morphicons)/);
  assert.match(read('src/desktop/ui/UI.tsx'),/components\/ui\/dialog/);
  assert.match(read('src/desktop/ui/UI.tsx'),/components\/ui\/dropdown-menu/);
  assert.match(read('src/main.tsx'),/import\.meta\.env\.DEV && parameters\.has\('prototype'\)/);
});
test('action icons use Lucide and vendored component sources retain their licenses and hashes',()=>{
  const icons=read('src/desktop/ui/icons.tsx');assert.match(icons,/from 'lucide-react'/);assert.doesNotMatch(icons,/MorphIcon|morphicons/);
  for(const name of ['Lucide-ISC.txt','Inter-OFL.txt'])assert.ok(read('assets/licenses/'+name).length>500);
  for(const name of ['shadcn-MIT.txt','Radix-MIT.txt'])assert.ok(read('assets/licenses/'+name).length>500);
  const ledger=JSON.parse(read('docs/ui/sources.json'));
  for(const entry of ledger.entries)assert.equal(createHash('sha256').update(read(entry.snapshot)).digest('hex'),entry.sha256,entry.snapshot);
});
test('table selection uses stable path IDs and never the upstream page-only select-all',()=>{
  const table=read('src/desktop/ui/SyncChangesTable.tsx');assert.match(table,/getRowId:change=>rowKey\(change.path\)/);assert.doesNotMatch(table,/toggleAllPageRowsSelected|CUSTOMERS/);assert.match(table,/toggleGroup\(rows,old\)/);
});
test('production output excludes integration fixtures and all spatial gradients',()=>{
  const root=new URL('../dist/assets/',import.meta.url);
  for(const file of readdirSync(root)){
    if(file.endsWith('.js'))assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/__SYNCFU_TEST__|fixture-plan-0|Fixture rejected operation/);
    if(file.endsWith('.css'))assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/(?:linear|radial|conic)-gradient\s*\(/i);
  }
});
