import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {deviceDisplayName,deviceProfileKey,normaliseDeviceProfiles,readDeviceProfiles,saveDeviceProfile,validDeviceEmoji} from '../src/desktop/device-metadata.ts';
import {defaultDeviceEmoji,deviceAvatarTone} from '../src/desktop/device-avatar-model.ts';

const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
test('device notes survive reload and always resolve by stable device ID',()=>{
  const storage=memory();
  assert.equal(saveDeviceProfile(storage,'peer-one',{alias:'  办公室电脑  ',emoji:'🧑🏽‍💻'}).failed,false);
  assert.equal(saveDeviceProfile(storage,'peer-two',{alias:'家里的电脑',emoji:'🏠'}).failed,false);
  const {profiles,failed}=readDeviceProfiles(storage);
  assert.equal(failed,false);
  assert.equal(deviceDisplayName({id:'peer-one',name:'renamed-machine.local'},profiles),'办公室电脑');
  assert.equal(deviceDisplayName({id:'unpaired',name:'other-machine'},profiles),'other-machine');
  assert.deepEqual(profiles['peer-two'],{alias:'家里的电脑',emoji:'🏠'});
  assert.deepEqual(profiles['peer-one'],{alias:'办公室电脑',emoji:'🧑🏽‍💻'});
});
test('clearing a profile restores the original machine name without touching another device',()=>{
  const storage=memory();
  saveDeviceProfile(storage,'peer-one',{alias:'Desk',emoji:'🖥️'});
  saveDeviceProfile(storage,'peer-two',{alias:'Work',emoji:'🏢'});
  saveDeviceProfile(storage,'peer-one',{alias:' ',emoji:''});
  const {profiles}=readDeviceProfiles(storage);
  assert.equal(deviceDisplayName({id:'peer-one',name:'original.local'},profiles),'original.local');
  assert.equal(profiles['peer-one'],undefined);
  assert.equal(profiles['peer-two'].alias,'Work');
});
test('emoji validation accepts composed emoji and rejects prose or multiple icons',()=>{
  for(const value of ['','💻','🖥️','🧑🏽‍💻','👨‍👩‍👧‍👦','🇨🇳','1️⃣'])assert.equal(validDeviceEmoji(value),true,value);
  for(const value of ['PC','A','🙂🙂','1','hello 💻'])assert.equal(validDeviceEmoji(value),false,value);
  const profiles=normaliseDeviceProfiles({peer:{alias:'Desk',emoji:'invalid'},broken:null});
  assert.equal(profiles.peer.emoji,'');assert.equal(profiles.broken,undefined);
});
test('unavailable or corrupt storage reports failure and does not claim a save',()=>{
  const blocked={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  assert.equal(readDeviceProfiles(blocked).failed,true);
  assert.equal(saveDeviceProfile(blocked,'peer',{alias:'Desk',emoji:'💻'}).failed,true);
  const storage=memory();saveDeviceProfile(storage,'peer',{alias:'Original',emoji:''});
  const noWrite={getItem:storage.getItem,setItem(){throw new Error('quota');}};
  const result=saveDeviceProfile(noWrite,'peer',{alias:'Changed',emoji:'💻'});
  assert.equal(result.failed,true);assert.equal(result.profiles.peer.alias,'Original');
  storage.setItem(deviceProfileKey,'{broken');assert.equal(readDeviceProfiles(storage).failed,true);
});
test('device type icons persist alongside custom names and emoji without changing legacy profiles',()=>{
  const storage=memory();
  saveDeviceProfile(storage,'peer',{alias:'My notebook',emoji:'🧑🏽‍💻',kind:'laptop'});
  assert.deepEqual(readDeviceProfiles(storage).profiles.peer,{alias:'My notebook',emoji:'🧑🏽‍💻',kind:'laptop'});
  saveDeviceProfile(storage,'peer',{alias:'Studio',emoji:'🎨',kind:'desktop'});
  assert.deepEqual(readDeviceProfiles(storage).profiles.peer,{alias:'Studio',emoji:'🎨',kind:'desktop'});
  const normalized=normaliseDeviceProfiles({legacy:{alias:'Old',emoji:'🐼'},invalid:{alias:'Keep name',emoji:'',kind:'untrusted'}});
  assert.deepEqual(normalized.legacy,{alias:'Old',emoji:'🐼'});
  assert.deepEqual(normalized.invalid,{alias:'Keep name',emoji:''});
});
test('default device artwork resolves to the verified local Fluent asset set',()=>{
  const provenance=JSON.parse(readFileSync(new URL('../assets/fluent-emoji/sources.json',import.meta.url),'utf8'));
  const emojis=new Set(provenance.entries.map(entry=>entry.emoji));
  for(const id of ['local-device','paired-device','a'.repeat(64),'b'.repeat(64)]){
    assert.equal(emojis.has(defaultDeviceEmoji(id)),true);
    assert.ok(deviceAvatarTone(id)>=0&&deviceAvatarTone(id)<5);
  }
  for(const entry of provenance.entries){
    const bytes=readFileSync(new URL('../assets/fluent-emoji/'+entry.file,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file);
    assert.equal(bytes.readUInt32BE(16),256);assert.equal(bytes.readUInt32BE(20),256);
  }
  assert.match(readFileSync(new URL('../assets/fluent-emoji/LICENSE.txt',import.meta.url),'utf8'),/Microsoft Corporation/);
});
