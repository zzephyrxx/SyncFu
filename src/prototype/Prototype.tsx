import '../styles.css';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, Check, ChevronRight, Folder, History, Laptop, Menu, Monitor, Moon, Plus, Settings2, Sun, X } from 'lucide-react';
import { Notice } from '../components';
import { PrototypeProvider, usePrototype } from './context';
import { Art, Dialog, Help, Status } from './UI';
import TaskWorkspace, { TaskFooter, type TaskAction, type TaskView } from './TaskWorkspace';
import Overview from './Overview';
import Settings from './Settings';
import PairingDialog from './PairingDialog';
import { ConflictDialog, HandoffDialog, IgnoredDialog, PolicyDialog, RiskDialog, TaskWizard } from './Dialogs';
import { chosenChanges, executeDemo, isPending, localDevice, makeTasks, managedChanges, remoteDevice, resolveChange, restoreDemo, type DemoChange, type DemoTask, type Resolution, type Scenario } from './model';
import { seedUsage, transferredBytes, type UsageEvent } from './usage';
import type { MessageKey, Values } from './messages';
import './prototype.css';
type Page = 'tasks' | 'overview' | 'devices' | 'history' | 'settings';
type DialogId = TaskAction | 'new' | 'pair' | 'handoff' | 'confirm' | 'remove' | 'undo' | null;
interface Batch { id: string; task: string; name: string; createdAt: number; changes: DemoChange[]; undone: boolean }
const scenarios: { id: Scenario; key: MessageKey }[] = [{ id: 'changes', key: 'scenarioChanges' }, { id: 'clean', key: 'ready' }, { id: 'offline', key: 'offline' }, { id: 'empty', key: 'scenarioEmpty' }, { id: 'permission', key: 'permission' }, { id: 'partial', key: 'partial' }, { id: 'shared', key: 'shared' }];
const iconUrl = new URL('../../assets/syncfu-icon.svg', import.meta.url).href;
const readScenario = (): Scenario => { const value = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('scenario') : null; return scenarios.some(s => s.id === value) ? value as Scenario : 'changes'; };
export default function Prototype() { return <PrototypeProvider><PrototypeApp /></PrototypeProvider>; }
function PrototypeApp() {
  const { prefs, setPref, dark, t, date } = usePrototype();
  const [tasks, setTasks] = useState(() => makeTasks(readScenario())); const [scenario, setScenario] = useState(readScenario);
  const [active, setActive] = useState('docs'); const [page, setPage] = useState<Page>(prefs.startup);
  const [taskView, setTaskView] = useState<TaskView>({ filter: 'all', search: '', page: 0 });
  const [collapsed, setCollapsed] = useState(false); const [dialog, setDialog] = useState<DialogId>(null);
  const [conflict, setConflict] = useState<string | null>(null); const [history, setHistory] = useState<Batch[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>(() => prefs.usageEnabled ? seedUsage() : []);
  const [job, setJob] = useState<{ task: DemoTask; step: number } | null>(null); const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<{ key: MessageKey; values?: Values; warning?: boolean } | null>(null);
  const [undoId, setUndoId] = useState(''); const [draftName, setDraftName] = useState('');
  const task = tasks.find(v => v.id === active) ?? tasks[0]; const busy = Boolean(job || scanning);
  const selected = task ? chosenChanges(task) : [];
  const updateTask = (next: DemoTask) => setTasks(old => old.map(item => item.id === next.id ? next : item));
  const notify = (key: MessageKey, values?: Values, warning = false) => setFeedback({ key, values, warning });
  useEffect(() => {
    if (!scanning) return; const timer = window.setTimeout(() => { setScanning(false); notify('simulationOnly'); }, 850);
    return () => window.clearTimeout(timer);
  }, [scanning]);
  useEffect(() => {
    if (!job) return;
    const timer = window.setTimeout(() => {
      if (job.step < 2) { setJob({ ...job, step: job.step + 1 }); return; }
      const result = executeDemo(job.task); const createdAt = Date.now(); const id = crypto.randomUUID();
      setTasks(old => old.map(item => item.id === result.task.id ? result.task : item));
      if (result.applied.length) {
        setHistory(old => [{ id, task: result.task.id, name: result.task.name, createdAt, changes: result.applied, undone: false }, ...old]);
        if (prefs.usageEnabled) setEvents(old => [...old, { id, createdAt, kind: 'sync', status: 'completed', files: result.applied.length, bytes: transferredBytes(result.applied) }]);
      }
      const pending = result.task.changes.filter(isPending).length;
      notify(pending > 0 ? 'syncDone' : 'syncDoneNoPending', { n: result.applied.length, pending }, pending > 0); setJob(null);
    }, 720);
    return () => window.clearTimeout(timer);
  }, [job, prefs.usageEnabled]);
  const openTask = (id: string) => { if (task?.id !== id) setTaskView({ filter: 'all', search: '', page: 0 }); setActive(id); setPage('tasks'); setFeedback(null); };
  const resetScenario = (value: Scenario) => { setScenario(value); setTasks(makeTasks(value)); setActive('docs'); setDialog(null); setConflict(null); setJob(null); setScanning(false); setFeedback(null); setHistory([]); setTaskView({ filter: 'all', search: '', page: 0 }); setPage('tasks'); };
  const action = (id: TaskAction) => { if (id === 'manage' && task) setDraftName(task.name); setDialog(id); };
  const pause = () => { if (!task) return; updateTask({ ...task, paused: !task.paused }); setJob(null); notify(task.paused ? 'resume' : 'paused'); };
  const execute = () => {
    if (!task || !selected.length || !task.online || task.paused || task.risk || task.problem || busy) return;
    if (prefs.confirmNormal || selected.some(c => c.kind !== 'create')) setDialog('confirm'); else setJob({ task, step: 0 });
  };
  const resolve = (resolution: Resolution) => { if (!task || !conflict) return; updateTask(resolveChange(task, conflict, resolution)); setConflict(null); notify('choiceSaved'); };
  const undo = history.find(h => h.id === undoId); const conflictChange = task?.changes.find(c => c.path === conflict);
  const pageKey: Record<Page, MessageKey> = { tasks: 'tasks', overview: 'overview', devices: 'devices', history: 'history', settings: 'settings' };
  return <div className={`p-app ${collapsed ? 'p-collapsed' : ''}`} data-density={prefs.density}>
    <div className="p-demo-strip"><span><span className="p-demo-dot" />{t('demoBoundary')}</span><label>{t('scenario')}<select aria-label={t('scenario')} value={scenario} onChange={e => resetScenario(e.target.value as Scenario)}>{scenarios.map(item => <option value={item.id} key={item.id}>{t(item.key)}</option>)}</select></label></div>
    <div className="p-frame"><aside className="p-sidebar" aria-label={t('tasks')}>
      <div className="p-brand"><img src={iconUrl} alt="" /><strong>SyncFu</strong><span className="p-brand-version">02</span></div>
      <button className={`p-nav-overview ${page === 'overview' ? 'active' : ''}`} aria-current={page === 'overview' ? 'page' : undefined} title={t('overview')} onClick={() => setPage('overview')}><BarChart3 size={21} /><span>{t('overview')}</span></button>
      <div className="p-sidebar-label"><span>{t('tasks')}</span><button className="p-icon" aria-label={t('newTask')} disabled={busy} onClick={() => setDialog('new')}><Plus size={18} /></button></div>
      <nav className="p-task-nav" aria-label={t('tasks')}>{tasks.map(item => <button key={item.id} className={`p-task-button ${page === 'tasks' && task?.id === item.id ? 'active' : ''}`} aria-current={page === 'tasks' && task?.id === item.id ? 'page' : undefined} aria-label={item.name} title={item.name} disabled={busy} onClick={() => openTask(item.id)}><Folder size={20} /><span><strong>{item.name}</strong><small><Status task={item} /></small></span><i className={`p-task-light ${item.risk || item.changes.some(isPending) ? 'attention' : item.online && !item.paused ? 'good' : ''}`} /></button>)}</nav>
      <button className="p-add-task" title={t('newTask')} aria-label={t('newTask')} disabled={busy} onClick={() => setDialog('new')}><Plus size={19} /><span>{t('newTask')}</span></button>
      <nav className="p-sidebar-bottom" aria-label={t('settings')}>{([{ id: 'devices', icon: Laptop }, { id: 'history', icon: History }, { id: 'settings', icon: Settings2 }] as const).map(({ id, icon: Icon }) => <button key={id} title={t(pageKey[id])} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setFeedback(null); }}><Icon size={20} /><span>{t(pageKey[id])}</span></button>)}</nav>
    </aside>
    <main className="p-main"><header className="p-topbar"><div className="p-topbar-context"><button className="p-icon" aria-label={t('collapse')} onClick={() => setCollapsed(!collapsed)}><Menu size={19} /></button><span>{t(pageKey[page])}</span>{page === 'tasks' && task && <><ChevronRight size={14} /><strong>{task.name}</strong></>}</div><div className="p-topbar-actions"><button className="p-icon" aria-label={t(dark ? 'light' : 'dark')} onClick={() => setPref('theme', dark ? 'light' : 'dark')}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button disabled={!tasks.length || busy} onClick={() => setDialog('handoff')}><ArrowUpRight size={17} /><span>{t('handoff')}</span></button></div></header>
      <div className="p-workspace">
        {feedback && (prefs.successMessages || feedback.warning) && <div className={`p-feedback ${feedback.warning ? 'warning' : ''}`} role="status"><Check size={17} /><span>{t(feedback.key, feedback.values)}</span><button className="p-icon" aria-label={t('close')} onClick={() => setFeedback(null)}><X size={16} /></button></div>}
        {page === 'tasks' && (task ? <TaskWorkspace key={task.id} task={task} view={taskView} onView={setTaskView} busy={busy} stage={scanning ? 'scan' : job ? (['prepare', 'transfer', 'verify'] as const)[job.step] : null} onUpdate={updateTask} onPause={pause} onInspect={() => setScanning(true)} onStop={() => { setJob(null); setScanning(false); notify('stopped'); }} onDialog={action} onConflict={setConflict} /> : <div className="p-centered p-empty-home"><Art kind="folder" size="large" /><h1>{t('emptyTitle')}</h1><Help>{t('emptyHelp')}</Help><button className="primary" onClick={() => setDialog('new')}><Plus size={18} />{t('newTask')}</button><button className="p-link" onClick={() => setDialog('pair')}>{t('connect')}</button></div>)}
        {page === 'overview' && <Overview events={events} onSettings={() => setPage('settings')} />}
        {page === 'devices' && <section><div className="p-page-heading"><h1>{t('devices')}</h1><button className="primary" onClick={() => setDialog('pair')}><Plus size={18} />{t('connect')}</button></div><div className="p-device-gallery">{[{ name: localDevice, kind: 'laptop', local: true }, { name: remoteDevice, kind: 'desktop', local: false }].map(device => <div className="p-device-object" key={device.name}><Art kind={device.kind as 'laptop' | 'desktop'} size="large" /><h2>{device.name}</h2><span>{t(device.local ? 'local' : 'online')}</span><button onClick={() => setDialog('grants')}><Folder size={16} />{t('grants')}</button></div>)}</div><Help>{t('wizardHelp')}</Help></section>}
        {page === 'history' && <section><div className="p-page-heading"><h1>{t('history')}</h1><History size={28} /></div>{history.length ? <div className="p-history-list">{history.map(batch => <div key={batch.id}><span className="p-history-icon"><History size={21} /></span><div><strong>{batch.name}</strong><span>{date(batch.createdAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {t('completedOps', { n: batch.changes.length })}</span></div><span className="p-pill">{t(batch.undone ? 'undone' : 'done')}</span><button disabled={batch.undone || busy || !tasks.some(item => item.id === batch.task)} onClick={() => { setUndoId(batch.id); setDialog('undo'); }}>{t('undo')}</button></div>)}</div> : <div className="p-centered"><Art kind="folder" size="large" /><h2>{t('noHistory')}</h2><Help>{t('historyHelp')}</Help><button onClick={() => setPage('tasks')}>{t('tasks')}</button></div>}</section>}
        {page === 'settings' && <Settings clearUsage={() => setEvents([])} />}
      </div>
      {page === 'tasks' && task && managedChanges(task).some(c => !c.resolution || c.resolution === 'later' || c.resolution === 'local' || c.resolution === 'remote') && <TaskFooter task={task} busy={busy} onExecute={execute} />}
    </main></div>
    {dialog === 'pair' && <PairingDialog onClose={() => setDialog(null)} />}
    {dialog === 'new' && <TaskWizard onClose={() => setDialog(null)} onCreate={created => { setTasks(old => [...old, created]); openTask(created.id); setDialog(null); }} />}
    {dialog === 'policy' && task && <PolicyDialog task={task} onClose={() => setDialog(null)} onSave={next => { updateTask(next); setDialog(null); notify('taskSaved'); }} />}
    {dialog === 'handoff' && <HandoffDialog tasks={tasks} onClose={() => setDialog(null)} />}
    {dialog === 'risk' && task && <RiskDialog task={task} onClose={() => setDialog(null)} onApprove={() => { updateTask({ ...task, risk: false, changes: task.changes.map(c => c.kind === 'delete' ? { ...c, selected: true } : c) }); setDialog(null); }} />}
    {dialog === 'ignored' && task && <IgnoredDialog task={task} onClose={() => setDialog(null)} onRestore={path => updateTask({ ...task, changes: task.changes.map(c => c.path === path ? { ...c, resolution: undefined, selected: false } : c) })} />}
    {conflictChange && task && <ConflictDialog task={task} change={conflictChange} onClose={() => setConflict(null)} onResolve={resolve} />}
    {dialog === 'confirm' && task && <Dialog title={t('confirmSync')} onClose={() => setDialog(null)}><div className="p-confirm-targets"><Monitor size={19} /><strong>{localDevice}</strong><span>{task.mode === 'both' ? '↔' : task.source === 'local' ? '→' : '←'}</span><strong>{remoteDevice}</strong></div><dl className="p-definition"><dt>{t('localFolder')}</dt><dd>{task.localPath}</dd><dt>{t('remoteFolder')}</dt><dd>{task.remotePath}</dd><dt>{t('rulesStep')}</dt><dd>{t(task.mode)}</dd></dl><Notice tone={selected.some(c => c.kind === 'delete') ? 'warning' : 'info'}><strong>{t('confirmImpact', { n: selected.length })}</strong>{selected.some(c => c.kind === 'delete') && <p>{t('deleteCount', { n: selected.filter(c => c.kind === 'delete').length })}</p>}<p>{t('backupFirst')}</p></Notice><p className="p-body-copy">{t('saveFiles')}</p><p className="p-body-copy">{t('simulationOnly')}</p><div className="modal-actions"><button onClick={() => setDialog(null)}>{t('back')}</button><button className="primary" disabled={busy || !selected.length || task.paused || task.risk || !task.online || Boolean(task.problem)} onClick={() => { setDialog(null); setJob({ task, step: 0 }); }}>{t('sync')}</button></div></Dialog>}
    {dialog === 'manage' && task && <Dialog title={t('more')} onClose={() => setDialog(null)}><div className="p-form"><label>{t('taskName')}<input maxLength={80} value={draftName} disabled={task.trust === 'shared' && !task.owner} onChange={e => setDraftName(e.target.value)} /></label><button disabled={!draftName.trim() || (task.trust === 'shared' && !task.owner)} onClick={() => { updateTask({ ...task, name: draftName.trim() }); setDialog(null); }}>{t('save')}</button><button onClick={() => { pause(); setDialog(null); }}>{t(task.paused ? 'resume' : 'pause')}</button><button className="p-danger" disabled={task.trust === 'shared' && !task.owner} onClick={() => setDialog('remove')}>{t('removeTask')}</button></div></Dialog>}
    {dialog === 'remove' && task && <Dialog title={t('removeTask')} onClose={() => setDialog(null)}><p className="p-body-copy">{t('removeHelp')}</p><div className="modal-actions"><button onClick={() => setDialog(null)}>{t('cancel')}</button><button className="p-danger" onClick={() => { setTasks(old => old.filter(item => item.id !== task.id)); setDialog(null); }}>{t('removeTask')}</button></div></Dialog>}
    {dialog === 'undo' && undo && <Dialog title={t('undoTitle')} onClose={() => setDialog(null)}><p className="p-body-copy">{t('undoHelp')}</p><p className="p-body-copy">{t('simulationOnly')}</p><div className="modal-actions"><button onClick={() => setDialog(null)}>{t('cancel')}</button><button className="primary" onClick={() => { setTasks(old => old.map(item => item.id === undo.task ? restoreDemo(item, undo.changes) : item)); setHistory(old => old.map(item => item.id === undo.id ? { ...item, undone: true } : item)); openTask(undo.task); setDialog(null); notify('restored', undefined, true); }}>{t('undo')}</button></div></Dialog>}
    {dialog === 'grants' && <Dialog title={t('grants')} onClose={() => setDialog(null)}><div className="p-grants-list">{tasks.map(item => <div key={item.id}><h3>{item.name}</h3><dl className="p-definition"><dt>{t('local')}</dt><dd>{item.localPath}</dd><dt>{t('remote')}</dt><dd>{item.remotePath}</dd></dl></div>)}</div><Help>{t('wizardHelp')}</Help><div className="modal-actions"><button onClick={() => setDialog(null)}>{t('done')}</button></div></Dialog>}
  </div>;
}
