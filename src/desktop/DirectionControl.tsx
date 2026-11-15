import {useEffect,useState} from 'react';
import type {Direction,TaskPolicy} from '../generated/policy';
import type {DesktopController} from './controller';
import {usePrototype} from '../prototype/context';
import {Dropdown,DropdownTrigger,DropdownPopover,DropdownItem,Dialog,Notice,Button} from './boardui/UI';
import {AppIcon} from './boardui/icons';
import {nextDirection,directionNeedsConfirmation} from './focus-model';
import {deviceDisplayName} from './device-metadata';
import {useDeviceProfiles} from './useDeviceProfiles';
export function DirectionControl({c,taskId,onAdvanced}:{c:DesktopController;taskId:string;onAdvanced:()=>void}){
  const {t}=usePrototype();const {profiles}=useDeviceProfiles();const view=c.snapshot.policy_states.find(v=>v.task===taskId);
  const [open,setOpen]=useState(false),[confirm,setConfirm]=useState<TaskPolicy|null>(null),[pending,setPending]=useState(false);
  const revision=view?.state.current.revision;useEffect(()=>setConfirm(null),[revision]);
  if(!view)return null;const policy=view.state.current,local=c.snapshot.device.id;
  const task=c.snapshot.tasks.find(task=>task.id===taskId),online=c.snapshot.peers.some(peer=>peer.id===task?.peer&&peer.online);
  const editable=policy.trust.kind==='personal'||policy.trust.kind==='shared'&&policy.trust.owner_device===local;
  const blocked=c.busy||!online||Boolean(c.prepared)||Boolean(view.state.pending)||Boolean(c.snapshot.phase)||c.snapshot.history.some(b=>b.status==='pending');
  const source=policy.direction.mode==='bidirectional'?local:policy.direction.source_device;
  const device=(id:string)=>id===local?c.snapshot.device:c.snapshot.peers.find(p=>p.id===id);
  const rawName=(id:string)=>device(id)?.name??id;
  const name=(id:string)=>deviceDisplayName({id,name:rawName(id)},profiles);
  const apply=async(next:TaskPolicy)=>{setConfirm(null);setPending(true);await c.run(async()=>{await c.transport('propose_task_policy',{task:taskId,expectedRevision:next.revision-1,next});c.invalidate();},'policy');setPending(false);};
  const choose=(mode:Direction['mode'],from=source)=>{setOpen(false);if(blocked)return;if(policy.trust.kind==='unclassified'){onAdvanced();return;}if(!editable)return;try{const next=nextDirection(policy,mode,from);if(JSON.stringify(next.direction)===JSON.stringify(policy.direction))return;if(directionNeedsConfirmation(policy,next))setConfirm(next);else void apply(next);}catch(error){c.setError(String(error));}};
  return <><Dropdown isOpen={open} onOpenChange={setOpen}><DropdownTrigger className="sf-mode-trigger" aria-label={t('rulesStep')} disabled={blocked}><AppIcon name={pending?'LoaderCircle':policy.direction.mode==='bidirectional'?'ArrowLeftRight':source===local?'ArrowRight':'ArrowLeft'} size={15}/>{t(pending?'switchingDirection':policy.direction.mode==='bidirectional'?'directionBoth':policy.direction.mode==='one_way_update'?'directionUpdate':'directionMirror')}<AppIcon name="ChevronDown" size={12}/></DropdownTrigger><DropdownPopover label={t('rulesStep')}><span className="sf-menu-label">{t('rulesStep')}</span>{(['bidirectional','one_way_update','one_way_mirror']as const).map(mode=><DropdownItem key={mode} disabled={!editable&&policy.trust.kind!=='unclassified'} onSelect={()=>choose(mode)}><AppIcon name={policy.direction.mode===mode?'Check':'ArrowRight'} size={15}/>{t(mode==='bidirectional'?'directionBoth':mode==='one_way_update'?'directionUpdate':'directionMirror')}</DropdownItem>)}{policy.direction.mode!=='bidirectional'&&<><div className="sf-menu-divider"/><span className="sf-menu-label">{t('source')}</span>{policy.endpoints.map(endpoint=><DropdownItem key={endpoint.device} disabled={!editable} onSelect={()=>choose(policy.direction.mode,endpoint.device)}><AppIcon name={source===endpoint.device?'Check':'Laptop'} size={15}/><span title={rawName(endpoint.device)}>{name(endpoint.device)}</span></DropdownItem>)}</>}<div className="sf-menu-divider"/><DropdownItem onSelect={onAdvanced}><AppIcon name="Settings2" size={15}/>{t('advancedRules')}</DropdownItem></DropdownPopover></Dropdown>
    {confirm&&<Dialog title={t('confirmDirection')} error={c.error} onClose={()=>setConfirm(null)}><div className="sf-direction-confirm"><strong title={rawName(confirm.direction.mode==='bidirectional'?local:confirm.direction.source_device)}>{name(confirm.direction.mode==='bidirectional'?local:confirm.direction.source_device)}</strong><AppIcon name="ArrowRight" size={20}/><strong title={rawName(confirm.endpoints.find(e=>e.device!==(confirm.direction.mode==='bidirectional'?local:confirm.direction.source_device))!.device)}>{name(confirm.endpoints.find(e=>e.device!==(confirm.direction.mode==='bidirectional'?local:confirm.direction.source_device))!.device)}</strong></div><Notice tone={confirm.direction.mode==='one_way_mirror'?'warning':'info'}>{t(confirm.direction.mode==='one_way_mirror'?'mirrorHelp':'updateHelp')}</Notice><p className="ui-body-copy">{t('directionNoWrite')}</p><div className="ui-modal-actions"><Button onClick={()=>setConfirm(null)}>{t('cancel')}</Button><Button variant="primary" disabled={blocked} onClick={()=>void apply(confirm)}>{t('apply')}</Button></div></Dialog>}
  </>;
}
