import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('the original user logo and native icons are byte-for-byte preserved',()=>{
  const checkpoint=JSON.parse(read('docs/boardui-redesign/logo-checkpoint.json'));
  for(const [file,expected] of Object.entries(checkpoint))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),expected,file);
  assert.match(read('src/desktop/Desktop.tsx'),/assets\/syncfu-icon\.svg/);assert.match(read('src/desktop/Desktop.tsx'),/src=\{logo\}/);
});
test('BoardUI production stylesheet contains no gradient functions or glass effects',()=>{
  const css=read('src/desktop/boardui/index.css');assert.doesNotMatch(css,/(?:linear|radial|conic)-gradient\s*\(/i);assert.doesNotMatch(css,/backdrop-filter/);
  assert.match(css,/source\(none\)/);
  const glyph=read('src/desktop/boardui/vendor/checkbox-glyph.tsx');assert.doesNotMatch(glyph,/bg-linear|from-accent|to-accent/);
});
test('BoardUI controls and EasyUI folder artwork compose the live desktop without a material chooser',()=>{
  const desktop=read('src/desktop/Desktop.tsx'),settings=read('src/desktop/LiveSettings.tsx');
  assert.match(desktop,/boardui\/index\.css/);assert.match(desktop,/design-system\/TaskFolder/);assert.doesNotMatch(desktop,/design-system\/index\.css/);assert.doesNotMatch(settings,/MaterialPicker|materialTheme|materialNeo|materialLiquid/);
  assert.match(read('src/main.tsx'),/import\.meta\.env\.DEV && parameters\.has\('prototype'\)/);
});
test('action icons use Morphicons with a reduced-motion policy and local font license',()=>{
  const icons=read('src/desktop/boardui/icons.tsx');assert.match(icons,/from 'morphicons\/react'/);assert.match(icons,/reducedMotion=\{animate\?'user':'always'\}/);
  for(const name of ['BoardUI-MIT.txt','Morphicons-MIT.txt','Lucide-ISC.txt','Inter-OFL.txt'])assert.ok(read('assets/boardui-licenses/'+name).length>500);
});
test('table selection uses stable path IDs and never the upstream page-only select-all',()=>{
  const table=read('src/desktop/boardui/SyncChangesTable.tsx');assert.match(table,/getRowId:change=>rowKey\(change.path\)/);assert.doesNotMatch(table,/toggleAllPageRowsSelected|CUSTOMERS/);assert.match(table,/toggleGroup\(rows,old\)/);
});
test('production output excludes integration fixtures and all spatial gradients',()=>{
  const root=new URL('../dist/assets/',import.meta.url);
  for(const file of readdirSync(root)){
    if(file.endsWith('.js'))assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/__SYNCFU_TEST__|fixture-plan-0|Fixture rejected operation/);
    if(file.endsWith('.css'))assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/(?:linear|radial|conic)-gradient\s*\(/i);
  }
});
