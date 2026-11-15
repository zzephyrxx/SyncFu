import {useEffect,useState} from 'react';
import {Button,Dialog,Notice,Spinner} from '../ui/UI';
import {Input} from '../../components/ui/input';
import {AppIcon} from '../ui/icons';
import {usePrototype} from '../../prototype/context';
import {DeviceAvatar,DeviceTypeIcon} from '../DeviceAvatar';
import {FluentEmoji,fluentEmojiChoices} from '../FluentEmoji';
import {defaultDeviceEmoji} from '../device-avatar-model';
import {StatusDot} from '../TaskIcon';
import {deviceDisplayName,validDeviceEmoji,type DeviceKind,type DeviceProfile} from '../device-metadata';
import {useDeviceProfiles} from '../useDeviceProfiles';
import type {Folder as FolderData,Peer} from '../../types';
import type {DesktopController} from '../controller';
import './devices.css';

const deviceKinds:DeviceKind[]=['laptop','desktop','phone'];

export function DevicesPage({c,onPair}:{c:DesktopController;onPair:()=>void}){
  const {t,prefs}=usePrototype();const zh=prefs.locale.startsWith('zh');
  const {profiles,saveProfile,storageFailed}=useDeviceProfiles();
  const [peer,setPeer]=useState<Peer|null>(null);const [folders,setFolders]=useState<FolderData[]>([]);const [loadingFolders,setLoadingFolders]=useState(false);
  const [confirm,setConfirm]=useState(false);const [revoke,setRevoke]=useState<string|null>(null);
  const [editing,setEditing]=useState<Peer|null>(null);const [draft,setDraft]=useState<DeviceProfile>({alias:'',emoji:''});const [editError,setEditError]=useState('');const [saved,setSaved]=useState('');
  const kindName=(kind:DeviceKind)=>zh?({laptop:'笔记本',desktop:'台式电脑',phone:'手机'}[kind]):({laptop:'Laptop',desktop:'Desktop',phone:'Phone'}[kind]);
  const closeGrants=()=>{setPeer(null);setConfirm(false);setRevoke(null);};
  const openEditor=(item:Peer)=>{setDraft({...profiles[item.id]??{alias:'',emoji:''}});setEditing(item);setEditError('');setSaved('');};
  useEffect(()=>{
    let stopped=false;
    if(peer){setLoadingFolders(true);void c.transport<FolderData[]>('local_folders',{peer:peer.id}).then(value=>{if(!stopped)setFolders(value);}).catch(e=>{if(!stopped)c.setError(String(e));}).finally(()=>{if(!stopped)setLoadingFolders(false);});}
    return()=>{stopped=true;};
  },[peer,c.transport]);
  const save=()=>{
    if(!editing)return;
    if(!validDeviceEmoji(draft.emoji)){setEditError(zh?'请选择或输入一个 emoji 作为设备图标。':'Choose or enter a single emoji for this device.');return;}
    if(!saveProfile(editing.id,draft)){setEditError(zh?'未能保存到本机，请重试。你的输入仍保留在这里。':'Could not save on this device. Try again; your changes are still here.');return;}
    setSaved(zh?'设备备注和图标已保存。':'Device name and icon saved.');setEditing(null);
  };
  return <section className="sf-page sf-devices-page">
    <header className="ui-page-heading"><div><h1>{t('devices')}</h1><p className="sf-device-page-description">{zh?'管理配对设备，以及你共享给它们的文件夹。':'Manage paired devices and the folders you share with them.'}</p></div><Button variant="primary" disabled={c.busy} onClick={onPair}><AppIcon name="Plus" size={17}/>{t('connect')}</Button></header>
    {storageFailed&&<Notice tone="warning">{zh?'设备备注和图标的本地存储暂不可用。':'Local storage for device names and icons is unavailable.'}</Notice>}
    {saved&&<p role="status" className="sf-device-save-status"><AppIcon name="CheckCircle2" size={15}/>{saved}</p>}
    <section className="sf-local-device" aria-label={t('local')}><DeviceAvatar deviceId={c.snapshot.device.id} profiles={profiles} local/><div className="sf-device-identity"><div className="sf-device-name-line"><h2>{c.snapshot.device.name}</h2><span className="sf-device-local-tag">{t('local')}</span></div><p>{zh?'你正在使用的设备':'The device you are using'}</p></div><span className="sf-device-status online"><StatusDot status="online" size={10}/>{zh?'已就绪':'Ready'}</span></section>
    <div className="sf-devices-list-heading"><h2>{zh?'已配对设备':'Paired devices'}<span>{c.snapshot.peers.length}</span></h2><span>{zh?`${c.snapshot.peers.filter(item=>item.online).length} 台在线`:`${c.snapshot.peers.filter(item=>item.online).length} online`}</span></div>
    <div className="sf-devices-list">{c.snapshot.peers.map(item=>{
      const displayName=deviceDisplayName(item,profiles),alias=profiles[item.id]?.alias,kind=profiles[item.id]?.kind??'desktop';
      const taskCount=c.snapshot.tasks.filter(task=>task.peer===item.id).length;
      return <section className="sf-device-row" key={item.id} aria-label={displayName}>
        <DeviceAvatar deviceId={item.id} profiles={profiles}/>
        <div className="sf-device-identity"><h2 title={item.name}>{displayName}</h2>{alias&&<p className="sf-device-original-name">{item.name}</p>}<div className="sf-device-meta"><span><DeviceTypeIcon kind={kind} size={13}/>{kindName(kind)}</span><span title={item.address}>{item.address}</span>{taskCount>0&&<span>{zh?`${taskCount} 项任务`:`${taskCount} ${taskCount===1?'task':'tasks'}`}</span>}</div></div>
        <span className={`sf-device-status ${item.online?'online':'offline'}`}><StatusDot status={item.online?'online':'offline'} size={11}/>{t(item.online?'online':'offline')}</span>
        <div className="sf-device-row-actions"><Button size="small" variant="ghost" onClick={()=>openEditor(item)} aria-label={zh?`编辑 ${displayName} 的备注和图标`:`Edit name and icon for ${displayName}`}><AppIcon name="Settings2" size={15}/>{zh?'自定义':'Customize'}</Button><Button size="small" disabled={c.busy} onClick={()=>{setFolders([]);setPeer(item);}}><AppIcon name="Folder" size={15}/>{t('grants')}</Button></div>
      </section>;
    })}</div>
    {!c.snapshot.peers.length&&<div className="sf-devices-empty"><AppIcon name="Monitor" size={34}/><h2>{zh?'把另一台设备连进来':'Connect another device'}</h2><p>{t('noPeers')}</p><Button onClick={onPair} disabled={c.busy}><AppIcon name="Plus" size={16}/>{t('connect')}</Button></div>}
    {editing&&<Dialog className="sf-device-editor" title={zh?'设备备注与图标':'Device name & icon'} description={zh?'仅在这台设备上显示，不会修改对方的设备名称。':'Only shown on this device. The remote device name stays the same.'} onClose={()=>setEditing(null)}>
      <form onSubmit={event=>{event.preventDefault();save();}}>
        <div className="sf-device-editor-preview"><DeviceAvatar deviceId={editing.id} profiles={{[editing.id]:{alias:draft.alias,emoji:validDeviceEmoji(draft.emoji)?draft.emoji:'',kind:draft.kind}}}/><div><strong>{draft.alias.trim()||editing.name}</strong><span>{editing.name}</span></div></div>
        <label className="sf-device-field" htmlFor="device-alias"><span>{zh?'备注名':'Display name'}</span><Input id="device-alias" value={draft.alias} maxLength={60} placeholder={editing.name} autoFocus onChange={event=>setDraft(old=>({...old,alias:event.target.value}))}/><small>{zh?'例如「家里的 Mac」或「办公室电脑」，留空则使用设备原名。':'For example, “Home Mac” or “Office PC”. Leave blank to use the original name.'}</small></label>
        <fieldset className="sf-device-emoji-field"><legend>{zh?'头像':'Avatar'}</legend><div className="sf-device-emoji-grid"><button className="sf-device-emoji-choice" type="button" aria-label={zh?'使用默认头像':'Use default avatar'} aria-pressed={!draft.emoji} onClick={()=>setDraft(old=>({...old,emoji:''}))}><FluentEmoji emoji={defaultDeviceEmoji(editing.id)}/><span className="sf-avatar-auto-label">{zh?'默认':'Auto'}</span></button>{fluentEmojiChoices.map(emoji=><button key={emoji} className="sf-device-emoji-choice" type="button" aria-label={`${zh?'设备图标':'Device icon'} ${emoji}`} aria-pressed={draft.emoji===emoji} onClick={()=>setDraft(old=>({...old,emoji}))}><FluentEmoji emoji={emoji}/></button>)}</div><label className="sf-device-custom-emoji" htmlFor="device-emoji"><span>{zh?'也可以输入喜欢的 emoji':'Or use your favorite emoji'}</span><Input id="device-emoji" value={draft.emoji} maxLength={32} placeholder="🙂" autoComplete="off" onChange={event=>setDraft(old=>({...old,emoji:event.target.value}))} aria-invalid={Boolean(draft.emoji&&!validDeviceEmoji(draft.emoji))} aria-describedby={editError?'device-profile-error':undefined}/></label></fieldset>
        <fieldset className="sf-device-kind-field"><legend>{zh?'类型图标':'Type icon'}</legend><div className="sf-device-kind-options">{deviceKinds.map(kind=><button type="button" key={kind} aria-pressed={(draft.kind??'desktop')===kind} onClick={()=>setDraft(old=>({...old,kind}))}><DeviceTypeIcon kind={kind} size={16}/>{kindName(kind)}</button>)}</div></fieldset>
        {editError&&<div id="device-profile-error"><Notice tone="error">{editError}</Notice></div>}
        <div className="ui-modal-actions"><Button onClick={()=>setEditing(null)}>{t('cancel')}</Button><Button type="submit" variant="primary">{zh?'保存':'Save'}</Button></div>
      </form>
    </Dialog>}
    {peer&&<Dialog error={c.error} title={`${deviceDisplayName(peer,profiles)} · ${t('grants')}`} description={peer.name} onClose={closeGrants}>
      {confirm?<><p>{t('forgetHelp')}</p><div className="ui-modal-actions"><Button onClick={()=>setConfirm(false)}>{t('cancel')}</Button><Button variant="danger" disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('forget_peer',{peer:peer.id});c.invalidate();closeGrants();})}>{t('forget')}</Button></div></>:revoke?<><p className="ui-body-copy">{folders.find(f=>f.id===revoke)?.path}</p><p>{t('wizardHelp')}</p><div className="ui-modal-actions"><Button onClick={()=>setRevoke(null)}>{t('cancel')}</Button><Button variant="danger" disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('revoke_folder',{id:revoke});c.invalidate();setFolders(old=>old.filter(f=>f.id!==revoke));setRevoke(null);})}>{t('revoke')}</Button></div></>:<>
        <p className="ui-body-copy">{t('wizardHelp')}</p>{loadingFolders?<p className="sf-device-folders-loading"><Spinner/>{t('loading')}</p>:folders.length?folders.map(folder=><div className="ui-ignored-row" key={folder.id}><AppIcon name="Folder" size={17}/><div><strong>{folder.path}</strong></div><Button size="small" disabled={c.busy} onClick={()=>setRevoke(folder.id)}>{t('revoke')}</Button></div>):<p className="ui-body-copy">{zh?'尚未向这台设备授权文件夹。':'No folders are shared with this device yet.'}</p>}
        <Button disabled={c.busy||loadingFolders} onClick={()=>void c.run(async()=>{const folder=await c.transport<FolderData|null>('grant_folder',{peer:peer.id});if(folder)setFolders(old=>[...old.filter(f=>f.id!==folder.id),folder]);})}><AppIcon name="Plus" size={16}/>{t('grantLocal')}</Button><div className="ui-modal-actions"><Button className="ui-danger" variant="ghost" disabled={c.busy} onClick={()=>setConfirm(true)}>{t('forget')}</Button><Button onClick={closeGrants}>{t('done')}</Button></div>
      </>}
    </Dialog>}
  </section>;
}
