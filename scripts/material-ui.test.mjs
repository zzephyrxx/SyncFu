import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {normalisePreferences,persistPreferences,readPreferences} from '../src/prototype/preferences.ts';
import {buildBlobPath} from '../src/desktop/design-system/blob.ts';
test('legacy material preferences are ignored without losing language, brightness or safety defaults',()=>{
  const old={locale:'ja',theme:'dark',motion:'off',backupDays:90,material:'neumorphic'};const p=normalisePreferences(old);
  assert.equal(p.material,undefined);assert.equal(p.locale,'ja');assert.equal(p.theme,'dark');assert.equal(p.motion,'off');assert.equal(p.backupDays,90);
  assert.equal(normalisePreferences({...p,material:'liquid'}).material,undefined);
});
test('light/dark preferences persist without reviving removed material controls',()=>{
  const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  for(const material of ['neumorphic','liquid'])for(const theme of ['light','dark']){
    persistPreferences(storage,normalisePreferences({material,theme}),'desktop');const read=readPreferences(storage,'desktop');assert.equal(read.material,undefined);assert.equal(read.theme,theme);
  }
});
test('liquid contour remains bounded throughout travel and settles identically',()=>{
  for(const progress of [-1,0,.1,.5,.9,1,2])for(const stretch of [0,.2,.5,5]){
    const path=buildBlobPath(48,28,progress,stretch);assert.ok(path.endsWith(' Z'));assert.equal((path.match(/ Q /g)||[]).length,12);
    const numbers=path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    numbers.forEach((n,i)=>assert.ok(n>=2&&n<=(i%2?26:46),`${progress}/${stretch}: ${n}`));
  }
  assert.equal(buildBlobPath(48,28,-1,-1),buildBlobPath(48,28,0,0));
  assert.notEqual(buildBlobPath(48,28,0,0),buildBlobPath(48,28,1,0));
});
test('desktop styling no longer imports the Focus or prototype visual owners',()=>{
  const source=readFileSync(new URL('../src/desktop/Desktop.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/import ['"].*(?:prototype\.css|desktop\.css)/);assert.doesNotMatch(source,/prototype\/(?:UI|Settings|Overview)/);
  assert.match(source,/boardui\/index\.css/);
  const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');assert.doesNotMatch(main,/import ['"]\.\/styles\.css/);
});
test('source adaptation ledger is pinned and local material licenses are present',()=>{
  const ledger=JSON.parse(readFileSync(new URL('../docs/material-redesign/sources.json',import.meta.url),'utf8'));
  assert.equal(ledger.entries.length,17);
  for(const entry of ledger.entries){assert.match(entry.commit,/^[a-f0-9]{40}$/);assert.match(entry.sha256,/^[a-f0-9]{64}$/);assert.ok(entry.adaptedTo);assert.ok(!entry.localSource);}
  for(const name of ['Solid-Glass-MIT.txt','EasyUI-MIT.txt','Caffeine-Day-MIT.txt','Neumorphism-BSD.txt','shadcn-MIT.txt'])assert.ok(readFileSync(new URL('../assets/material-licenses/'+name,import.meta.url),'utf8').length>500);
});
test('liquid switch has no always-running polling timer and keeps a stable label',()=>{
  const ui=readFileSync(new URL('../src/desktop/design-system/UI.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/setInterval/);assert.match(ui,/aria-label=\{label\} aria-checked=\{checked\}/);
  const dots=readFileSync(new URL('../src/desktop/design-system/DotStatus.tsx',import.meta.url),'utf8');
  assert.match(dots,/running&&allowed&&!document.hidden/);assert.match(dots,/cancelAnimationFrame/);
});
