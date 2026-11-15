import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {normalisePreferences,persistPreferences,readPreferences} from '../src/prototype/preferences.ts';
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
test('desktop styling no longer imports the Focus or prototype visual owners',()=>{
  const source=readFileSync(new URL('../src/desktop/Desktop.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/import ['"].*(?:prototype\.css|desktop\.css)/);assert.doesNotMatch(source,/prototype\/(?:UI|Settings|Overview)/);
  assert.match(source,/ui\/index\.css/);
  const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');assert.doesNotMatch(main,/import ['"]\.\/styles\.css/);
});
