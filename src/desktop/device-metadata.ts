export type DeviceKind='laptop'|'desktop'|'phone';
export interface DeviceProfile { alias: string; emoji: string; kind?:DeviceKind }
export type DeviceProfiles = Record<string, DeviceProfile>;
export const deviceProfileKey = 'syncfu-desktop:v1:device-profiles';
interface StorageLike { getItem(key:string):string|null; setItem(key:string,value:string):void }

// Emoji sequences include variation selectors, skin tones, flags and ZWJ families.
const emojiPattern = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D|[\u{E0020}-\u{E007F}])*$/u;
export function validDeviceEmoji(value:string):boolean {
  const input=value.trim();
  if(!input)return true;
  return input.length<=32&&Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(input)).length===1&&emojiPattern.test(input);
}
export function normaliseDeviceProfiles(value:unknown):DeviceProfiles {
  const profiles:DeviceProfiles=Object.create(null);
  if(!value||typeof value!=='object'||Array.isArray(value))return profiles;
  for(const [id,raw] of Object.entries(value)){
    if(!id||!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const data=raw as Record<string,unknown>;
    const alias=typeof data.alias==='string'?data.alias.trim().slice(0,60):'';
    const emoji=typeof data.emoji==='string'&&validDeviceEmoji(data.emoji)?data.emoji.trim():'';
    const kind=data.kind==='laptop'||data.kind==='desktop'||data.kind==='phone'?data.kind:undefined;
    if(alias||emoji||kind)profiles[id]={alias,emoji,...(kind?{kind}:{})};
  }
  return profiles;
}
export function readDeviceProfiles(storage:StorageLike):{profiles:DeviceProfiles;failed:boolean} {
  try{return {profiles:normaliseDeviceProfiles(JSON.parse(storage.getItem(deviceProfileKey)??'null')),failed:false};}
  catch{return {profiles:Object.create(null),failed:true};}
}
export function saveDeviceProfile(storage:StorageLike,id:string,profile:DeviceProfile):{profiles:DeviceProfiles;failed:boolean} {
  const current=readDeviceProfiles(storage);
  if(current.failed||!id||!validDeviceEmoji(profile.emoji))return {...current,failed:true};
  const profiles=normaliseDeviceProfiles({...current.profiles,[id]:profile});
  try{storage.setItem(deviceProfileKey,JSON.stringify(profiles));return {profiles,failed:false};}
  catch{return {profiles:current.profiles,failed:true};}
}
export function deviceDisplayName(device:{id:string;name:string},profiles:DeviceProfiles):string {
  return profiles[device.id]?.alias||device.name;
}
