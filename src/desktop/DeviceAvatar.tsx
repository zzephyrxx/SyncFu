import {AppIcon} from './boardui/icons';
import type {DeviceProfiles} from './device-metadata';
import './device-avatar.css';

export function DeviceAvatar({deviceId,profiles,local=false,className=''}:{deviceId:string;profiles:DeviceProfiles;local?:boolean;className?:string}){
  const emoji=profiles[deviceId]?.emoji;
  return <span className={`sf-device-avatar ${emoji?'has-emoji':''} ${className}`} aria-hidden="true">{emoji||<AppIcon name={local?'Laptop':'Monitor'} size={25} strokeWidth={1.5}/>}</span>;
}
