import {Laptop,Monitor,Smartphone} from 'lucide-react';
import type {DeviceKind,DeviceProfiles} from './device-metadata';
import {FluentEmoji} from './FluentEmoji';
import {defaultDeviceEmoji,deviceAvatarTone} from './device-avatar-model';
import './device-avatar.css';

export function DeviceTypeIcon({kind='desktop',size=14}:{kind?:DeviceKind;size?:number}){
  const Icon=kind==='phone'?Smartphone:kind==='laptop'?Laptop:Monitor;
  return <Icon size={size} strokeWidth={1.65} aria-hidden="true"/>;
}
export function DeviceAvatar({deviceId,profiles,local=false,className='',showType=true}:{deviceId:string;profiles:DeviceProfiles;local?:boolean;className?:string;showType?:boolean}){
  const profile=profiles[deviceId],emoji=profile?.emoji||defaultDeviceEmoji(deviceId);
  return <span className={`sf-device-avatar ${className}`} data-tone={deviceAvatarTone(deviceId)} aria-hidden="true"><FluentEmoji emoji={emoji}/>{showType&&<span className="sf-device-type-badge"><DeviceTypeIcon kind={profile?.kind??(local?'laptop':'desktop')} size={11}/></span>}</span>;
}
