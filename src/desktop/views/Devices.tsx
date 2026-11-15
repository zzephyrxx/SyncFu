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
  const [unpair,setUnpair]=useState<Peer|null>(null);const [revoke,setRevoke]=useState<string|null>(null);
  const [editing,setEditing]=useState<Peer|null>(null);const [draft,setDraft]=useState<DeviceProfile>({alias:'',emoji:''});const [editError,setEditError]=useState('');const [saved,setSaved]=useState('');
  const kindName=(kind:DeviceKind)=>zh?({laptop:'笔记本',desktop:'台式电脑',phone:'手机'}[kind]):({laptop:'Laptop',desktop:'Desktop',phone:'Phone'}[kind]);
  const closeGrants=()=>{setPeer(null);setRevoke(null);};
  const unpairBlocked=c.busy||Boolean(c.snapshot.phase)||c.snapshot.history.some(batch=>batch.status==='pending');
  const unpairTasks=c.snapshot.tasks.filter(task=>task.peer===unpair?.id);
  const grantFolder=()=>{if(!peer||c.busy||loadingFolders)return;void c.run(async()=>{const folder=await c.transport<FolderData|null>('grant_folder',{peer:peer.id});if(folder)setFolders(old=>[...old.filter(f=>f.id!==folder.id),folder]);});};
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
        <div className="sf-device-row-actions"><Button size="small" variant="ghost" onClick={()=>openEditor(item)} aria-label={zh?`编辑 ${displayName} 的备注和图标`:`Edit name and icon for ${displayName}`}><AppIcon name="Settings2" size={15}/>{zh?'自定义':'Customize'}</Button><Button size="small" disabled={c.busy} onClick={()=>{setFolders([]);setPeer(item);}}><AppIcon name="Folder" size={15}/>{t('grants')}</Button><Button size="small" variant="ghost" className="sf-device-unpair" disabled={unpairBlocked} title={unpairBlocked?(zh?'请先完成或核对当前批次。':'Finish or reconcile the current batch first.'):undefined} aria-label={`${t('forget')} · ${displayName}`} onClick={()=>{c.setError('');setUnpair(item);}}><AppIcon name="Unplug" size={15}/>{t('forget')}</Button></div>
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
    {unpair&&<Dialog className="sf-device-unpair-dialog" error={c.error} title={zh?'确认解除配对？':'Unpair this device?'} description={zh?'此操作只移除连接和授权，不会删除你的文件。':'This removes the connection and access, not your files.'} dismissDisabled={c.busy} onClose={()=>setUnpair(null)}>
      <div className="sf-unpair-device"><DeviceAvatar deviceId={unpair.id} profiles={profiles}/><div><strong>{deviceDisplayName(unpair,profiles)}</strong>{deviceDisplayName(unpair,profiles)!==unpair.name&&<span>{unpair.name}</span>}</div></div>
      <p className="sf-unpair-help">{zh?'解除后，这台设备将无法访问你在本机授权的文件夹；再次连接需要重新配对。':'This device will lose access to folders shared by this computer. Connecting again requires pairing again.'}</p>
      <div className="sf-unpair-tasks"><strong>{zh?`同时从本机移除 ${unpairTasks.length} 项相关同步任务`:`Also removes ${unpairTasks.length} related ${unpairTasks.length===1?'task':'tasks'} from this computer`}</strong>{unpairTasks.length>0&&<ul>{unpairTasks.map(task=><li key={task.id}><AppIcon name="Folder" size={14}/><span>{task.label}</span></li>)}</ul>}</div>
      {unpairBlocked&&!c.busy&&<Notice tone="warning">{zh?'请先完成或核对当前批次，再解除配对。':'Finish or reconcile the current batch before unpairing.'}</Notice>}
      <div className="ui-modal-actions"><Button disabled={c.busy} onClick={()=>setUnpair(null)}>{t('cancel')}</Button><Button variant="danger" disabled={unpairBlocked} onClick={()=>void c.run(async()=>{await c.transport('forget_peer',{peer:unpair.id});c.invalidate();setSaved(zh?`已解除与「${deviceDisplayName(unpair,profiles)}」的配对。`:`Unpaired ${deviceDisplayName(unpair,profiles)}.`);setUnpair(null);})}>{c.busy&&<Spinner/>}{t('forget')}</Button></div>
    </Dialog>}
    {peer&&<Dialog className="sf-device-grants" error={c.error} title={`${deviceDisplayName(peer,profiles)} · ${t('grants')}`} description={deviceDisplayName(peer,profiles)!==peer.name?peer.name:undefined} dismissDisabled={c.busy} onClose={closeGrants}>
      {revoke?<><p className="sf-grant-revoke-path">{folders.find(f=>f.id===revoke)?.path}</p><p className="ui-body-copy">{zh?'撤销后，对端无法继续访问这个文件夹，使用它的相关任务将无法继续同步。你的文件不会删除。':'Revoking access prevents this peer from using the folder, so related tasks can no longer sync it. Your files are kept.'}</p><div className="ui-modal-actions"><Button disabled={c.busy} onClick={()=>setRevoke(null)}>{t('cancel')}</Button><Button variant="danger" disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('revoke_folder',{id:revoke});c.invalidate();setFolders(old=>old.filter(f=>f.id!==revoke));setRevoke(null);})}>{t('revoke')}</Button></div></>:<>
        <p className="ui-body-copy sf-grants-help">{t('wizardHelp')}</p>
        {loadingFolders?<p className="sf-device-folders-loading"><Spinner/>{t('loading')}</p>:folders.length?<>
          <div className="sf-grants-toolbar"><h3>{zh?'已授权文件夹':'Shared folders'}<span>{folders.length}</span></h3><Button size="small" variant="ghost" className="sf-grants-add" disabled={c.busy} onClick={grantFolder}><AppIcon name="Plus" size={15}/>{zh?'添加文件夹':'Add folder'}</Button></div>
          <ul className="sf-grants-list">{folders.map(folder=><li key={folder.id}><AppIcon name="Folder" size={18}/><div><strong>{folder.label}</strong><span title={folder.path}>{folder.path}</span></div><Button size="small" variant="ghost" className="sf-grant-revoke" disabled={c.busy} aria-label={`${t('revoke')} · ${folder.label}`} onClick={()=>setRevoke(folder.id)}>{t('revoke')}</Button></li>)}</ul>
        </>:<div className="sf-grants-empty"><AppIcon name="Folder" size={28}/><p>{zh?'尚未向这台设备授权文件夹。':'No folders are shared with this device yet.'}</p><Button variant="primary" disabled={c.busy} onClick={grantFolder}><AppIcon name="Plus" size={16}/>{t('grantLocal')}</Button></div>}
        <div className="ui-modal-actions"><Button onClick={closeGrants} disabled={c.busy}>{t('done')}</Button></div>
      </>}
    </Dialog>}
  </section>;
}
