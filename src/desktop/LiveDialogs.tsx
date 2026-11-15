import { useEffect, useState } from 'react';
import { Folder, ShieldAlert } from './ui/glyphs';
import { Checkbox as ConsentCheckbox } from '../components/ui/selection';
import { Notice, Spinner, Dialog, Art, Help, Button } from './ui/UI';
import { AppIcon } from './ui/icons';
import { SyncRoute } from './SyncRoute';
import { DeviceAvatar } from './DeviceAvatar';
import { deviceDisplayName } from './device-metadata';
import { useDeviceProfiles } from './useDeviceProfiles';
import { usePrototype } from '../prototype/context';
import type { ConflictPreview, Decision, PolicyView, ReviewNote, TaskPolicy } from '../generated/policy';
import type { Folder as FolderData, Task } from '../types';
import { FileIdentity } from './FileIdentity';
import { fileIdentity } from './focus-model';
import { compareText } from './line-diff';
import { canConfirm } from './selection';
import type { DesktopController } from './controller';
import { AppSelect } from '../components/ui/select';
import './new-task.css';

export function LiveRules({ c, view, onClose }: { c: DesktopController; view: PolicyView; onClose: () => void }) {
  const { t, prefs } = usePrototype(); const local = c.snapshot.device.id;
  const current = view.state.current; const pending = view.state.pending;
  const [draft, setDraft] = useState<TaskPolicy>(() => ({ ...current, revision: current.revision + 1, direction: current.trust.kind==='unclassified' ? prefs.defaultMode==='both'?{mode:'bidirectional'}:{mode:prefs.defaultMode==='update'?'one_way_update':'one_way_mirror',source_device:local} : current.direction, trust: current.trust }));
  const [excludeText,setExcludeText]=useState(current.excludes.join('\n'));
  const allowed = current.trust.kind === 'unclassified' || current.trust.kind === 'personal' || current.trust.owner_device === local;
  const name = (id: string) => id === local ? c.snapshot.device.name : c.snapshot.peers.find(p=>p.id===id)?.name ?? id;
  const shown = pending?.proposal.next ?? draft;
  const submit = () => void c.run(async()=> { await c.transport('propose_task_policy',{task:current.task,expectedRevision:current.revision,next:draft}); c.invalidate(); onClose(); });
  return <Dialog error={c.error} title={t('rules')} onClose={onClose}><div className="ui-form">
    {pending&&<Notice tone="warning"><strong>{t('pendingPolicy')}</strong><p>{name(pending.proposal.proposed_by)} · v{pending.proposal.next.revision}</p></Notice>}
    {!allowed&&!pending&&<Notice>{t('sharedHelp',{device: current.trust.kind==='shared'?name(current.trust.owner_device):''})}</Notice>}
    <fieldset className="ui-mode-picker" disabled={c.busy||!allowed||Boolean(pending)}><legend>{t('rulesStep')}</legend>{(['bidirectional','one_way_update','one_way_mirror'] as const).map(mode=><label key={mode} className={shown.direction.mode===mode?'selected':''}><input type="radio" name="live-mode" checked={shown.direction.mode===mode} onChange={()=>setDraft(old=>({...old,direction:mode==='bidirectional'?{mode}:{mode,source_device:local}}))}/><span><strong>{t(mode==='bidirectional'?'both':mode==='one_way_update'?'update':'mirror')}</strong><Help>{t(mode==='bidirectional'?'bothHelp':mode==='one_way_update'?'updateHelp':'mirrorHelp')}</Help></span></label>)}</fieldset>
    {shown.direction.mode!=='bidirectional'&&<label>{t('source')}<AppSelect aria-label={t('source')} disabled={c.busy||!allowed||Boolean(pending)} value={shown.direction.source_device} onValueChange={value=>setDraft(old=>({...old,direction:old.direction.mode==='bidirectional'?old.direction:{...old.direction,source_device:value},conflicts:{kind:'hold'}}))} options={shown.endpoints.map(e=>({value:e.device,label:name(e.device)}))}/></label>}
    {shown.direction.mode==='one_way_mirror'&&<Notice tone="warning">{t('mirrorHelp')}</Notice>}
    <label>{t('relation')}<AppSelect aria-label={t('relation')} disabled={c.busy||!allowed||Boolean(pending)} value={shown.trust.kind} onValueChange={value=>setDraft(old=>({...old,trust:value==='personal'?{kind:'personal'}:{kind:'shared',owner_device:local}}))} options={[{value:'unclassified',label:t('chooseRelationship'),disabled:true},{value:'personal',label:t('personal')},{value:'shared',label:t(shown.trust.kind==='shared'&&shown.trust.owner_device!==local?'shared':'shareOwner')}]}/></label>
    <details className="sync-rule-extras"><summary>{t('excludedPaths')} ({shown.excludes.length})</summary><label>{t('excludedPaths')}<textarea rows={3} disabled={c.busy||!allowed||Boolean(pending)} value={pending?shown.excludes.join('\n'):excludeText} onChange={e=>{setExcludeText(e.target.value);setDraft(old=>({...old,excludes:e.target.value.split('\n').map(p=>p.trim()).filter(Boolean)}));}}/></label></details>
    <div className="ui-modal-actions"><button onClick={onClose}>{t('close')}</button>{pending?<>
      {!pending.accepted&&pending.proposal.proposed_by!==local&&<><button disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('answer_task_policy',{task:current.task,proposal:pending.proposal.id,accept:false});c.invalidate();onClose();})}>{t('reject')}</button><button className="primary" disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('answer_task_policy',{task:current.task,proposal:pending.proposal.id,accept:true});c.invalidate();onClose();})}>{t('accept')}</button></>}
      <button disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('reconcile_task_policy',{task:current.task});c.invalidate();onClose();})}>{t('reconcilePolicy')}</button>
    </>:allowed&&<button className="primary" disabled={c.busy||draft.trust.kind==='unclassified'} onClick={submit}>{t('submitPolicy')}</button>}</div>
  </div></Dialog>;
}

export function LiveNewTask({ c, onClose }: { c: DesktopController; onClose: () => void }) {
  const { t, prefs }=usePrototype();const [peer,setPeer]=useState(c.snapshot.peers[0]?.id??'');
  const {profiles}=useDeviceProfiles();
  const [folders,setFolders]=useState<{local:FolderData[];remote:FolderData[]}>({local:[],remote:[]});
  const [local,setLocal]=useState('');const [remote,setRemote]=useState('');const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [refreshKey,setRefreshKey]=useState(0);
  const [mode,setMode]=useState<'bidirectional'|'one_way_update'|'one_way_mirror'>(prefs.defaultMode==='both'?'bidirectional':prefs.defaultMode==='update'?'one_way_update':'one_way_mirror');
  const [relation,setRelation]=useState<''|'personal'|'shared'>('');const [created,setCreated]=useState<Task|null>(null);
  const disabled=c.busy||loading||Boolean(created);
  useEffect(()=>{let cancelled=false;if(!peer)return;setLoading(true);setError('');setFolders({local:[],remote:[]});setLocal('');setRemote('');
    void c.transport<{local:FolderData[];remote:FolderData[]}>('folders',{peer}).then(value=>{if(!cancelled){setFolders(value);setLocal(value.local[0]?.id??'');setRemote(value.remote[0]?.id??'');}}).catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};
  },[peer,refreshKey,c.transport]);
  const create=()=>void c.run(async()=>{
    if(!relation||created)return;
    const task=await c.transport<Task>('create_task',{peer,local,remote});setCreated(task);
    await c.refresh();c.openTask(task.id,true);
    const view=await c.transport<PolicyView>('task_policy',{task:task.id});const current=view.state.current;
    // Idempotent Link may return an existing task. Never reclassify it implicitly.
    if(current.trust.kind!=='unclassified'||view.state.pending){onClose();return;}
    const next:TaskPolicy={...current,revision:current.revision+1,direction:mode==='bidirectional'?{mode}:{mode,source_device:c.snapshot.device.id},trust:relation==='personal'?{kind:'personal'}:{kind:'shared',owner_device:c.snapshot.device.id}};
    await c.transport('propose_task_policy',{task:task.id,expectedRevision:current.revision,next});c.invalidate();onClose();
  },'policy');
  const selectedPeer=c.snapshot.peers.find(item=>item.id===peer);
  const localFolder=folders.local.find(folder=>folder.id===local),remoteFolder=folders.remote.find(folder=>folder.id===remote);
  const folderLabel=(folder:FolderData,list:FolderData[])=>{
    const name=fileIdentity(folder.path).name||folder.path;
    return list.filter(item=>fileIdentity(item.path).name===name).length>1?folder.path:name;
  };
  return <Dialog className="sf-new-task" error={c.error} title={t('newTask')} description={t('wizardHelp')} onClose={onClose}><div className="sf-new-task-form">
    {error&&<Notice tone="error">{error}</Notice>}{created&&<Notice>{t('taskCreatedRulesPending')}</Notice>}
    <label className="sf-new-task-peer"><span>{t('devices')}</span><AppSelect aria-label={t('devices')} value={peer} disabled={disabled} onValueChange={setPeer} options={c.snapshot.peers.map(p=>{const name=deviceDisplayName(p,profiles);return {value:p.id,label:`${name}${name!==p.name?` (${p.name})`:''} · ${t(p.online?'online':'offline')}`};})}/></label>
    <SyncRoute localDevice={deviceDisplayName(c.snapshot.device,profiles)} remoteDevice={selectedPeer?deviceDisplayName(selectedPeer,profiles):'—'} localOriginalName={c.snapshot.device.name} remoteOriginalName={selectedPeer?.name} remoteOnline={selectedPeer?.online} mode={mode==='bidirectional'?'both':'send'} localIcon={<DeviceAvatar deviceId={c.snapshot.device.id} profiles={profiles} local/>} remoteIcon={selectedPeer?<DeviceAvatar deviceId={selectedPeer.id} profiles={profiles}/>:undefined}
      localContent={<div className="sf-new-task-folder"><label>{t('localFolder')}<AppSelect aria-label={t('localFolder')} value={local} title={localFolder?.path} disabled={disabled} onValueChange={setLocal} options={[{value:'',label:'—'},...folders.local.map(folder=>({value:folder.id,label:folderLabel(folder,folders.local)}))]}/></label><p className="sf-new-task-folder-path" title={localFolder?.path}>{loading?t('loading'):localFolder?.path??'—'}</p><Button variant="ghost" size="small" disabled={disabled||!peer} onClick={()=>void c.run(async()=>{const folder=await c.transport<FolderData|null>('grant_folder',{peer});if(folder){setFolders(old=>({...old,local:[...old.local.filter(f=>f.id!==folder.id),folder]}));setLocal(folder.id);}})}><Folder size={14}/>{t('grantLocal')}</Button></div>}
      remoteContent={<div className="sf-new-task-folder"><label>{t('remoteFolder')}<AppSelect aria-label={t('remoteFolder')} value={remote} title={remoteFolder?.path} disabled={disabled} onValueChange={setRemote} options={[{value:'',label:'—'},...folders.remote.map(folder=>({value:folder.id,label:folderLabel(folder,folders.remote)}))]}/></label><p className="sf-new-task-folder-path" title={remoteFolder?.path}>{loading?t('loading'):remoteFolder?.path??t('waitingFolders')}</p><Button variant="ghost" size="small" disabled={disabled||!peer} onClick={()=>setRefreshKey(v=>v+1)}>{loading?<Spinner/>:<AppIcon name="RefreshCw" size={14}/>} {t('refresh')}</Button></div>}/>
    <fieldset className="sf-new-task-options" disabled={disabled}><legend>{t('rulesStep')}</legend><div className="sf-new-task-mode-options">{(['bidirectional','one_way_update','one_way_mirror']as const).map(value=><label className="sf-new-task-choice" key={value}><input type="radio" name="new-direction" value={value} checked={mode===value} onChange={()=>setMode(value)}/><span>{t(value==='bidirectional'?'directionBoth':value==='one_way_update'?'directionUpdate':'directionMirror')}</span></label>)}</div>{mode==='one_way_mirror'?<Notice tone="warning">{t('mirrorHelp')}</Notice>:<p className="sf-new-task-option-help">{t(mode==='bidirectional'?'bothHelp':'updateHelp')}</p>}</fieldset>
    <fieldset className="sf-new-task-options" disabled={disabled}><legend>{t('relation')}</legend><div className="sf-new-task-relation-options">{(['personal','shared']as const).map(value=><label className="sf-new-task-choice" key={value}><input type="radio" name="new-relationship" value={value} checked={relation===value} onChange={()=>setRelation(value)}/><span>{t(value==='personal'?'personalSetup':'shareOwner')}</span></label>)}</div></fieldset>
    <div className="ui-modal-actions"><Button onClick={onClose}>{t(created?'close':'cancel')}</Button>{!created&&<Button variant="primary" disabled={disabled||!local||!remote||!relation} onClick={create}>{c.busy&&<Spinner/>}{t('setupAndSend')}</Button>}</div>
  </div></Dialog>;
}
export function LiveConflict({ c, paths, onClose, onExclude }: { c: DesktopController; paths: string[]; onClose: () => void; onExclude: (path: string) => void }) {
  const { t, bytes }=usePrototype();const plan=c.plan;const [preview,setPreview]=useState<ConflictPreview|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [skip,setSkip]=useState<'later'|'ignore_version'>('later');
  useEffect(()=>{let cancelled=false;setPreview(null);setError('');setLoading(paths.length===1);if(plan&&paths.length===1)void c.transport<ConflictPreview>('preview_conflict',{plan:plan.id,digest:plan.digest,path:paths[0]}).then(v=>{if(!cancelled)setPreview(v);}).catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[plan?.id,paths.join('\0'),c.transport]);
  if(!plan)return null;const policy=c.snapshot.policy_states.find(v=>v.task===plan.task.id)?.state.current;
  const allowed=policy?.trust.kind==='personal'||(policy?.trust.kind==='shared'&&policy.trust.owner_device===c.snapshot.device.id);
  const conflicts=plan.conflicts.filter(conflict=>paths.includes(conflict.path));const resolvable=conflicts.length===paths.length&&conflicts.every(conflict=>conflict.resolvable);
  const devices=[c.snapshot.device,...c.snapshot.peers.filter(p=>p.id===plan.task.peer)];
  const textDiff=preview?.versions.every(v=>v.text!==null)&&preview.versions.length===2?compareText(preview.versions[0].text!,preview.versions[1].text!):null;
  const decide=(decision:Decision)=>void c.decide(paths.map(path=>({path,decision}))).then(ok=>{if(ok)onClose();});
  return <Dialog className="sync-drawer" error={c.error} title={paths.length===1?fileIdentity(paths[0]).name:t('batchChoice')} description={paths.length===1?fileIdentity(paths[0]).parent||t('rootFolder'):t('batchScope',{n:paths.length})} onClose={onClose}><div className="ui-compare">
    {error&&<Notice tone="error">{error}</Notice>}{loading&&<div className="ui-running"><Spinner/>{t('loading')}</div>}
    {!resolvable&&<Notice tone="warning">{t('structural')}</Notice>}
    {preview&&<div className="ui-compare-columns">{preview.versions.map((version,i)=><section key={version.device}><header><Art kind={i?'desktop':'laptop'} size="small"/><strong>{devices.find(d=>d.id===version.device)?.name??version.device}</strong></header>{version.text!==null?<div className="ui-code">{textDiff?textDiff.rows.map((row,n)=>{const line=i?row.right:row.left;return <p key={n} className={line?.changed?i?'ui-added':'ui-removed':''}><span>{line?.number??' '}</span>{line?.text||' '}</p>;}):version.text.split('\n').slice(0,500).map((line,n)=><p key={n}><span>{n+1}</span>{line||' '}</p>)}{(textDiff?.truncated||version.text.split('\n').length>500)&&<p>{t('previewTruncated')}</p>}</div>:<dl className="ui-file-meta"><dt>{t('size')}</dt><dd>{version.entry?.type==='file'?bytes(version.entry.bytes):'—'}</dd><dt>{t('fingerprint')}</dt><dd className="live-hash">{version.entry?.type==='file'?version.entry.sha256:'—'}</dd><dd>{t(version.reason==='missing'?'missingFile':version.reason==='too_large'?'tooLarge':version.reason==='directory'?'structural':'binaryHelp')}</dd></dl>}</section>)}</div>}
    <div className="ui-resolution-actions">{devices.map(device=>{const deletion=paths.length===1&&conflicts[0]?.versions[device.id]===null;const target=devices.find(d=>d.id!==device.id)?.id;const directionAllowed=(policy?.direction.mode==='bidirectional'||policy?.direction.source_device===device.id)&&(c.scope==='all'||(c.scope==='send'?device.id===c.snapshot.device.id:device.id!==c.snapshot.device.id));return <button key={device.id} disabled={!allowed||!resolvable||!directionAllowed||c.busy||loading||!!error||!target} onClick={()=>decide({choice:'use',source_device:device.id})}>{t(deletion?'useDeletion':'useVersion',{device:device.name})}</button>;})}</div>
    {c.scope!=='all'&&<p className="ui-body-copy">{t('scopeConflict')}</p>}
    {!allowed&&<Notice>{policy?.trust.kind==='unclassified'?t('classify'):t('sharedHelp',{device:policy?.trust.kind==='shared'?devices.find(d=>d.id===(policy?.trust.kind==='shared'?policy.trust.owner_device:''))?.name??'':t('unclassified')})}</Notice>}
    <div className="ui-skip-row"><AppSelect aria-label={t('noAction')} value={skip} onValueChange={value=>setSkip(value as typeof skip)} options={[{value:'later',label:t('later')},{value:'ignore_version',label:t('ignoreVersion')}]}/><button disabled={c.busy||loading} onClick={()=>decide({choice:skip})}>{t('apply')}</button></div><Help>{t('localReview')}</Help>
    {paths.length===1&&<button className="ui-link" disabled={!allowed||c.busy} onClick={()=>onExclude(paths[0])}>{t('exclude')}</button>}
    <div className="ui-modal-actions"><button onClick={onClose}>{t('back')}</button></div>
  </div></Dialog>;
}
export function LiveConfirmation({c}:{c:DesktopController}) {
  const {t}=usePrototype();const [approved,setApproved]=useState(false);const [page,setPage]=useState(0);
  const prepared=c.prepared;if(!prepared)return null;
  const policy=c.snapshot.policy_states.find(p=>p.task===prepared.plan.task.id)?.state.current;
  const manager=policy?.trust.kind==='personal'||(policy?.trust.kind==='shared'&&policy.trust.owner_device===c.snapshot.device.id);
  const selection=new Set(prepared.preview.selected);
  const changes=prepared.plan.comparison.changes.filter(ch=>selection.has(ch.path));const deletes=changes.filter(ch=>ch.action==='delete').length;
  const names=(id:string)=>id===c.snapshot.device.id?c.snapshot.device.name:c.snapshot.peers.find(p=>p.id===id)?.name??id;
  const pages=Math.max(1,Math.ceil(changes.length/50));
  return <section className="sync-receipt" aria-label={t('confirmTransfer')}>
    {c.error&&<Notice tone="error">{c.error}</Notice>}
    <dl className="ui-definition"><dt>{t('localFolder')}</dt><dd>{prepared.plan.task.local_path}</dd><dt>{t('remoteFolder')}</dt><dd>{prepared.plan.task.remote_path}</dd></dl>
    <p className={deletes?'ui-danger-text':'ui-body-copy'}>{t('dependencies',{n:changes.length})}{deletes>0&&` · ${t('deleteCount',{n:deletes})}`}</p>
    {prepared.preview.risks.filter(r=>r.reasons.length).map(r=><Notice tone="warning" key={r.device}><strong>{names(r.device)}</strong><p>{t('riskWindowCounts',{recent:r.recent_deletions,n:r.selected_deletions})}</p><p>{r.reasons.map(reason=>t(reason==='source_empty'?'sourceEmpty':reason==='large_deletion'?'largeDeletion':'relativeDeletion')).join(' / ')}</p><p>{t('riskHelp')}</p></Notice>)}
    <details><summary>{t('showOperations')}</summary><div className="live-confirm-list">{changes.slice(page*50,(page+1)*50).map(ch=><div key={ch.path}><FileIdentity path={ch.path} directory={(ch.after??ch.before)?.type==='directory'}/><strong>{t(ch.action==='delete'?(ch.target===0?'deleteLocal':'deleteRemote'):(ch.target===0?'toLocal':'toRemote'))}<br/>{ch.target===0?c.snapshot.device.name:names(prepared.plan.task.peer)}</strong></div>)}</div>{pages>1&&<div className="ui-pagination"><button disabled={!page} onClick={()=>setPage(v=>v-1)}>{t('back')}</button>{page+1}/{pages}<button disabled={page>=pages-1} onClick={()=>setPage(v=>v+1)}>{t('next')}</button></div>}</details>
    {prepared.preview.approval_required&&!manager&&<Notice tone="warning">{t('riskSummary')}</Notice>}
    {prepared.preview.approval_required&&<ConsentCheckbox className="ui-consent" aria-label={t('consent')} isSelected={approved} isDisabled={!manager} onChange={setApproved}>{t('consent')}</ConsentCheckbox>}
    <p className="ui-body-copy">{t(prepared.plan.undo_of?'laterEdits':'backupFirst')}</p>
    <div className="ui-modal-actions"><button onClick={()=>c.setPrepared(null)}>{t('changeSelection')}</button><button className="primary" disabled={c.busy||Boolean(c.snapshot.phase)||!canConfirm(c.snapshot,prepared.plan,prepared.preview.selected)||(prepared.preview.approval_required&&(!approved||!manager))} onClick={()=>void c.execute(approved)}><ShieldAlert size={17}/>{t(prepared.plan.undo_of?'undo':'confirmTransfer')}</button></div>
  </section>;
}
export function LiveIgnored({c,task,onClose,onRules}:{c:DesktopController;task:Task;onClose:()=>void;onRules:()=>void}) {
  const {t}=usePrototype();const [notes,setNotes]=useState<ReviewNote[]>([]);const [error,setError]=useState('');const policy=c.snapshot.policy_states.find(p=>p.task===task.id)?.state.current;
  useEffect(()=>{let cancelled=false;void c.transport<ReviewNote[]>('review_notes',{task:task.id}).then(v=>{if(!cancelled)setNotes(v);}).catch(e=>{if(!cancelled)setError(String(e));});return()=>{cancelled=true;};},[task.id,c.transport]);
  return <Dialog error={c.error} title={t('ignored')} onClose={onClose}>{error&&<Notice tone="error">{error}</Notice>}<h3>{t('localNotes')}</h3><Help>{t('localReview')}</Help>{notes.map(note=><div className="ui-ignored-row" key={note.path}><div><FileIdentity path={note.path}/><span>{t(note.ignored?'ignoreVersion':'later')}</span></div><button disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('clear_review_note',{task:task.id,path:note.path});setNotes(old=>old.filter(n=>n.path!==note.path));c.invalidate();})}>{t('undoIgnore')}</button></div>)}{!notes.length&&<p className="ui-body-copy">{t('ignoredEmpty')}</p>}<h3>{t('excludedPaths')}</h3>{policy?.excludes.map(path=><p className="ui-body-copy" key={path}>{path}</p>)}<button onClick={onRules}>{t('rules')}</button><div className="ui-modal-actions"><button onClick={onClose}>{t('done')}</button></div></Dialog>;
}
