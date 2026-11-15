import {Folder} from 'lucide-react';
import {Circle,type IconWeight} from '@phosphor-icons/react';
import './task-icons.css';

export function TaskIcon({tone=0,size=20,active=false,className=''}:{tone?:number;size?:number;active?:boolean;className?:string}){
  return <span className={`sf-task-icon ${className}`} data-tone={Math.abs(tone)%6} data-active={active} aria-hidden="true"><Folder size={size} strokeWidth={1.6}/></span>;
}
export type TaskStatus='online'|'offline'|'syncing'|'paused'|'changes'|'pending'|'idle'|'conflict';
const weights:Record<TaskStatus,IconWeight>={online:'fill',offline:'regular',syncing:'duotone',paused:'thin',changes:'fill',pending:'bold',idle:'thin',conflict:'fill'};
export function StatusDot({status,label,size=12,className=''}:{status:TaskStatus;label?:string;size?:number;className?:string}){
  return <span className={`sf-status-dot ${className}`} data-status={status} role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true}><Circle size={size} weight={weights[status]}/></span>;
}
