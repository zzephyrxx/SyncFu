// Tauri desktop shell composed with shadcn primitives and real synchronization state.
import {useEffect,useRef,useState} from 'react';
import {desktop} from '../api';
import {PrototypeProvider,usePrototype} from '../prototype/context';
import type {UsageEvent} from '../prototype/usage';
import type {MessageKey} from '../prototype/messages';
import {useDesktopController,useTaskAutoCheck,type Transport} from './controller';
import {Art,Button,Dialog,Dropdown,DropdownItem,DropdownPopover,DropdownTrigger,Help,IconButton,NavItem,Notice,Spinner} from './ui/UI';
import {AppIcon} from './ui/icons';
import {LiveTask,LiveFooter,type LiveTaskView} from './LiveTask';
import {LiveRules,LiveNewTask,LiveConflict,LiveConfirmation,LiveIgnored} from './LiveDialogs';
import {LivePairing} from './LivePairing';
import {LiveSettings} from './LiveSettings';
import {DevicesPage} from './views/Devices';
import {HistoryPage,HandoffDialog} from './views/Activity';
import {OverviewPage} from './views/Overview';
import {TaskIcon,StatusDot} from './TaskIcon';
import {DeviceAvatar} from './DeviceAvatar';
import {useDeviceProfiles} from './useDeviceProfiles';
import {deviceDisplayName} from './device-metadata';
import './ui/index.css';
import '../components/ui/tokens.css';
import '../components/ui/primitives.css';
import './workspace.css';
type Page='tasks'|'overview'|'devices'|'history'|'settings';
const taskTone=(id:string)=>[...id].reduce((hash,char)=>(hash*31+char.charCodeAt(0))>>>0,0)%4;
const logo=new URL('../../assets/syncfu-icon.svg',import.meta.url).href;
export default function Desktop({transport,testMode=false}:{transport?:Transport;testMode?:boolean}){return <PrototypeProvider mode="desktop">{desktop||transport?<DesktopApp transport={transport} testMode={testMode}/>:<BrowserBoundary/>}</PrototypeProvider>;}
function BrowserBoundary(){const {t}=usePrototype();return <div className="board-app"><main className="ui-centered"><img src={logo} alt="SyncFu" width={64}/><h1>SyncFu</h1><p>{t('browserOnly')}</p>{import.meta.env.DEV&&<a href="/?desktop-test">{t('demo')}</a>}</main></div>;}
function DesktopApp({transport,testMode}:{transport?:Transport;testMode:boolean}){
  const {t,prefs,setPref}=usePrototype();const {profiles}=useDeviceProfiles();const c=useDesktopController(transport);const [page,setPage]=useState<Page>(prefs.startup);const collapsed=prefs.sidebarCollapsed;const setCollapsed=(value:boolean)=>setPref('sidebarCollapsed',value);
  const [dialog,setDialog]=useState<'new'|'pair'|'rules'|'ignored'|'handoff'|null>(null);const [conflict,setConflict]=useState<string[]|null>(null);const [taskView,setTaskView]=useState<LiveTaskView>({filter:'all',search:'',page:0});
  const workspace=useRef<HTMLDivElement>(null),focusPage=useRef(false);
  useEffect(()=>setTaskView({filter:'all',search:'',page:0}),[c.active]);
  useEffect(()=>{if(focusPage.current){workspace.current?.focus({preventScroll:true});focusPage.current=false;}},[page,c.active]);
  useTaskAutoCheck(c,page==='tasks'&&!dialog&&!conflict);
  const task=c.snapshot.tasks.find(item=>item.id===c.active),view=c.snapshot.policy_states.find(item=>item.task===task?.id);
  const labels:Record<Page,MessageKey>={tasks:'tasks',overview:'overview',devices:'devices',history:'history',settings:'preferences'};
  const go=(next:Page)=>{if(page!==next)focusPage.current=true;setPage(next);c.setPrepared(null);setDialog(null);setConflict(null);};
  const goTask=(id:string)=>{if(id!==c.active)focusPage.current=true;c.openTask(id);go('tasks');};
  const newTask=()=>setDialog(c.snapshot.peers.length?'new':'pair');
  const events:UsageEvent[]=c.usage.records.map(record=>({id:record.id,createdAt:record.created*1000,kind:'sync',status:'completed',files:record.files,bytes:Number(record.bytes)}));
  const excluded=(path:string)=>{if(!view)return;void c.run(async()=>{const current=view.state.current;await c.transport('propose_task_policy',{task:current.task,expectedRevision:current.revision,next:{...current,revision:current.revision+1,excludes:[...new Set([...current.excludes,path])]}});c.invalidate();setConflict(null);setDialog('rules');});};
  if(!c.snapshot.device.id)return <div className="board-app"><main className="ui-centered"><img src={logo} alt="SyncFu" width={56}/><h1>SyncFu</h1>{c.error?<Notice tone="error">{c.error}<Button onClick={()=>void c.run(c.refresh)}>{t('refresh')}</Button></Notice>:<><Spinner/><p>{t('loading')}</p></>}</main></div>;
  const isMac=(desktop||testMode)&&/Mac/.test(navigator.platform);
  const sidebarLabel=prefs.locale==='zh-CN'?(collapsed?'展开侧栏':'收起侧栏'):prefs.locale==='zh-TW'?(collapsed?'展開側欄':'收起側欄'):(collapsed?'Expand sidebar':'Collapse sidebar');
  return <div className={`board-app ${isMac?'native-mac':''} ${collapsed?'is-collapsed':''}`} data-density={prefs.density}>
    <header className="sf-window-toolbar" data-tauri-drag-region={desktop?'':undefined}>
      <div className="sf-toolbar-leading" data-tauri-drag-region={desktop?'':undefined}>
        {isMac&&<div className="sf-traffic-space" aria-hidden="true"/>}
        <IconButton label={sidebarLabel} variant="ghost" aria-expanded={!collapsed} aria-controls="app-sidebar" onClick={()=>setCollapsed(!collapsed)}><AppIcon name={collapsed?'PanelLeftOpen':'PanelLeftClose'} size={20}/></IconButton>
        <div className="sf-wordmark" data-tauri-drag-region={desktop?'':undefined}><img src={logo} alt=""/><strong>SyncFu</strong></div>
      </div>
      <div className="sf-toolbar-context" data-tauri-drag-region={desktop?'':undefined}>
        <div className="sf-breadcrumb" data-tauri-drag-region={desktop?'':undefined}><span>{t(labels[page])}</span>{page==='tasks'&&task&&<><AppIcon name="ChevronRight" size={14}/><strong>{c.plan?.undo_of?t('undoPreview'):task.label}</strong></>}</div>
        <Dropdown><DropdownTrigger className="sf-more-button" aria-label={t('moreTools')}><AppIcon name="MoreHorizontal" size={19}/></DropdownTrigger><DropdownPopover label={t('moreTools')}><DropdownItem disabled={c.busy||!c.snapshot.tasks.length} onSelect={()=>setDialog('handoff')}><AppIcon name="ArrowUpRight"/>{t('handoff')}</DropdownItem></DropdownPopover></Dropdown>
      </div>
    </header>
    <div className="sf-shell">
      <aside className="sf-sidebar" id="app-sidebar" aria-label={t('moreTools')}>
        <Button className="sf-new-task" disabled={c.busy} onClick={newTask} aria-label={t('newTask')} title={t('newTask')}><AppIcon name="Plus" size={19}/><span>{t('newTask')}</span></Button>
        <nav className="sf-primary-nav" aria-label={t('overview')}>{([{id:'overview',icon:'LayoutDashboard'},{id:'devices',icon:'Laptop'},{id:'history',icon:'History'}] as const).map(item=><NavItem key={item.id} active={page===item.id} onClick={()=>go(item.id)} aria-label={t(labels[item.id])} title={t(labels[item.id])}><AppIcon name={item.icon} size={18}/><span>{t(labels[item.id])}</span>{item.id==='devices'&&<small className="sf-nav-count">{c.snapshot.peers.length+1}</small>}</NavItem>)}</nav>
        <div className="sf-sidebar-heading"><span>{t('tasks')}</span><span className="sf-task-count">{c.snapshot.tasks.length}</span></div>
        <nav className="sf-task-nav" aria-label={t('tasks')}>{c.snapshot.tasks.map(item=>{
          const state=c.snapshot.policy_states.find(p=>p.task===item.id),remote=c.snapshot.peers.find(p=>p.id===item.peer);
          const direction=state?.state.current.direction;
          const status=state?.state.pending?'pending':state?.paused?'paused':!remote?.online?'offline':c.snapshot.dirty.includes(item.id)?'changes':'idle';
          return <NavItem key={item.id} active={page==='tasks'&&task?.id===item.id} disabled={c.busy&&item.id!==c.active} aria-label={item.label} title={item.label} onClick={()=>goTask(item.id)}>
            <TaskIcon tone={taskTone(item.id)} size={21} active={page==='tasks'&&task?.id===item.id}/>
            <span className="sf-task-label"><strong>{item.label}</strong><small><AppIcon name={!direction||direction.mode==='bidirectional'?'ArrowLeftRight':direction.source_device===item.peer?'ArrowDownLeft':'ArrowUpRight'} size={12}/>{remote?deviceDisplayName(remote,profiles):item.peer}</small></span>
            <StatusDot status={status} label={t(status==='pending'?'pendingPolicy':status==='changes'?'changes':status==='idle'?'notScanned':status)}/>
          </NavItem>;
        })}</nav>
        <nav className="sf-sidebar-bottom" aria-label={t('settings')}><NavItem active={page==='settings'} onClick={()=>go('settings')} aria-label={t('settings')} title={t('settings')}><AppIcon name="Settings2" size={18}/><span>{t('settings')}</span></NavItem></nav>
        <div className="sf-local" title={c.snapshot.device.name}><DeviceAvatar deviceId={c.snapshot.device.id} profiles={profiles} local/><span><strong>{deviceDisplayName(c.snapshot.device,profiles)}</strong><small>{t('local')}</small></span><StatusDot status="online" label={t('online')}/></div>
      </aside>
      <main className="sf-main">
        <div className="sf-workspace" ref={workspace} tabIndex={-1} role="region" aria-label={`${t(labels[page])}${page==='tasks'&&task?` · ${task.label}`:''}`}>
          {c.error&&<Notice tone="error"><strong>{t('liveError')}</strong><p>{c.error}</p><Button size="small" variant="ghost" onClick={()=>c.setError('')}>{t('close')}</Button></Notice>}{c.snapshot.network_error&&<Notice tone="warning">{c.snapshot.network_error}</Notice>}{c.snapshot.pending.length>0&&dialog!=='pair'&&<Notice><div className="sf-notice-row"><span>{t('pairWaiting')}</span><Button size="small" onClick={()=>setDialog('pair')}>{t('connect')}</Button></div></Notice>}
          {page==='tasks'&&(task?<LiveTask key={task.id} controller={c} task={task} view={taskView} onView={setTaskView} onRules={()=>setDialog('rules')} onConflict={path=>setConflict([path])} onIgnored={()=>setDialog('ignored')} onBatch={setConflict}/>:<div className="sf-empty"><Art kind="folder" size="large"/><h2>{t('emptyTitle')}</h2><Help>{t('emptyHelp')}</Help><Button variant="primary" onClick={newTask}><AppIcon name="Plus"/>{t(c.snapshot.peers.length?'newTask':'connect')}</Button></div>)}
          {page==='devices'&&<DevicesPage c={c} onPair={()=>setDialog('pair')}/>}{page==='history'&&<HistoryPage c={c} onTask={()=>go('tasks')}/>}{page==='settings'&&<LiveSettings c={c}/>}{page==='overview'&&(c.usageError?<Notice tone="error">{c.usageError}<Button onClick={()=>void c.run(c.refreshUsage)}>{t('refresh')}</Button></Notice>:!c.usageReady?<div className="ui-centered"><Spinner/>{t('loading')}</div>:<OverviewPage enabled={c.usage.enabled} events={events} onSettings={()=>go('settings')}/>)}
        </div>{page==='tasks'&&<LiveFooter controller={c} onShowSelected={()=>setTaskView(old=>({...old,filter:old.filter==='selected'?'all':'selected',search:'',page:0}))}/>}
      </main>
    </div>
    {dialog==='pair'&&<LivePairing c={c} onClose={()=>setDialog(null)}/>}{dialog==='new'&&<LiveNewTask c={c} onClose={()=>{setDialog(null);setPage('tasks');}}/>}{dialog==='rules'&&view&&<LiveRules key={`${view.task}-${view.state.current.revision}-${view.state.pending?.proposal.id??''}`} c={c} view={view} onClose={()=>setDialog(null)}/>}{dialog==='ignored'&&task&&<LiveIgnored c={c} task={task} onClose={()=>setDialog(null)} onRules={()=>setDialog('rules')}/>}{conflict&&c.plan&&<LiveConflict c={c} paths={conflict} onClose={()=>setConflict(null)} onExclude={excluded}/>} {dialog==='handoff'&&<HandoffDialog c={c} onClose={()=>setDialog(null)} onTask={goTask}/>}
    {c.prepared&&<Dialog title={t(c.prepared.plan.undo_of?'undoPreview':'confirmTransfer')} onClose={()=>c.setPrepared(null)}><LiveConfirmation key={c.prepared.preview.selection_digest} c={c}/></Dialog>}
  </div>;
}
