import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, CircleHelp, File, FileText, Folder, ListFilter, MoreHorizontal, Pause, Play, RefreshCw, Search, Settings2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { Checkbox, Notice, Spinner } from '../components';
import { usePrototype } from './context';
import { Art, Direction, Help, SuccessMark } from './UI';
import { canManage, chosenChanges, isExecutable, isIgnored, isPending, localDevice, managedChanges, remoteDevice, targetOf, type DemoChange, type DemoTask } from './model';
import type { MessageKey } from './messages';
export type TaskAction = 'policy' | 'manage' | 'risk' | 'ignored' | 'grants';
export interface TaskView { filter: 'all' | DemoChange['kind']; search: string; page: number }
interface Props {
  view: TaskView; onView: Dispatch<SetStateAction<TaskView>>;
  task: DemoTask; busy: boolean; stage: MessageKey | null;
  onUpdate: (task: DemoTask) => void; onPause: () => void; onInspect: () => void;
  onStop: () => void; onDialog: (id: TaskAction) => void;
  onConflict: (path: string) => void;
}
const changeKey = (kind: DemoChange['kind']): MessageKey => kind === 'update' ? 'changeUpdate' : kind;
export default function TaskWorkspace({ task, busy, stage, view, onView, onUpdate, onPause, onInspect, onStop, onDialog, onConflict }: Props) {
  const { t, bytes, number } = usePrototype();
  const { filter, search, page } = view;
  const setFilter = (filter: TaskView['filter']) => onView(old => ({ ...old, filter }));
  const setSearch = (search: string) => onView(old => ({ ...old, search }));
  const setPage = (page: number) => onView(old => ({ ...old, page }));
  const changes = managedChanges(task).filter(c => !isIgnored(c));
  const selected = chosenChanges(task); const ignoredCount = managedChanges(task).filter(isIgnored).length;
  const filtered = useMemo(() => managedChanges(task).filter(c => !isIgnored(c) && (filter === 'all' || (filter === 'conflict' ? isPending(c) : c.kind === filter)) && c.path.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())), [task, filter, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / 20)); const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  const groups = new Map<string, DemoChange[]>();
  for (const c of visible) { const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : '/'; groups.set(dir, [...(groups.get(dir) ?? []), c]); }
  const eligible = filtered.filter(isExecutable); const allowed = canManage(task);
  const inspectBlocked = !task.online || task.paused || Boolean(task.problem) || busy;
  const choose = (path: string) => onUpdate({ ...task, changes: task.changes.map(c => c.path === path && isExecutable(c) ? { ...c, selected: !c.selected } : c) });
  return <div className="p-task-workspace">
    <header className="p-task-heading"><div><h1>{task.name}</h1><span className="p-relation">{t(task.trust === 'shared' ? 'shared' : 'personal')}</span></div><div className="p-heading-actions"><button aria-label={t('rules')} onClick={() => onDialog('policy')} disabled={busy}><Settings2 size={17} /><span>{t('rules')}</span></button><button className="p-icon" aria-label={t('more')} disabled={busy} onClick={() => onDialog('manage')}><MoreHorizontal size={22} /></button></div></header>
    <section className="p-connection-stage" aria-label={t('rulesStep')}>
      <Endpoint local name={localDevice} path={task.localPath} onPath={() => onDialog('grants')} />
      <div className="p-connection-center"><Direction task={task} running={Boolean(stage && stage !== 'scan')} /><span>{t(task.mode)}</span></div>
      <Endpoint name={remoteDevice} path={task.remotePath} online={task.online} onPath={() => onDialog('grants')} />
    </section>
    <div className="p-task-toolbar"><span className={`p-mode-state ${task.paused ? 'paused' : ''}`}><i />{t(task.paused ? 'paused' : task.automatic ? 'automatic' : 'manual')}</span><Help>{t(task.mode === 'both' ? 'bothHelp' : task.mode === 'update' ? 'updateHelp' : 'mirrorHelp')}</Help><button className="p-icon" title={t(task.paused ? 'resume' : 'pause')} aria-label={t(task.paused ? 'resume' : 'pause')} onClick={onPause}>{task.paused ? <Play size={18} /> : <Pause size={18} />}</button></div>
    {!task.online && <Notice tone="warning"><strong>{t('offline')}</strong><Help>{t('autoHelp')}</Help><button className="p-link" onClick={() => onUpdate({ ...task, online: true })}>{t('reconnect')}</button></Notice>}
    {task.paused && <Notice><strong>{t('paused')}</strong><Help>{t('pauseHelp')}</Help></Notice>}
    {task.problem && <Notice tone="warning"><strong>{t(task.problem === 'permission' ? 'permission' : 'partial')}</strong><p>{t(task.problem === 'permission' ? 'permissionHelp' : 'partialHelp')}</p><button className="p-link" onClick={() => onUpdate({ ...task, problem: undefined })}>{t(task.problem === 'permission' ? 'grants' : 'reconcile')}</button></Notice>}
    {task.risk && <Notice tone="warning"><div className="p-notice-action"><strong><ShieldAlert size={19} />{t('riskTitle', { n: changes.filter(c => c.kind === 'delete').length })}</strong><button onClick={() => onDialog('risk')}>{t('reviewDeletes')}</button></div></Notice>}
    {!allowed && <Notice><ShieldCheck size={17} />{t('sharedHelp', { device: remoteDevice })}</Notice>}
    {stage && <div className="p-running" role="status"><Spinner /><strong>{t(stage)}</strong><span>{t('selectedCount', { n: selected.length })}</span><button onClick={onStop}>{t('stop')}</button></div>}
    <div className="p-changes-heading"><h2>{t('changes')}<span>{number(changes.length)}</span></h2><div><button className="p-icon-label" aria-label={t('ignored')} onClick={() => onDialog('ignored')} disabled={busy} title={t('ignored')}><ListFilter size={17} /><span>{t('ignored')}</span></button><button disabled={inspectBlocked} onClick={onInspect}><RefreshCw size={16} />{t('check')}</button></div></div>
    {changes.length ? <>
      <div className="p-filterbar"><div className="p-filters" role="group" aria-label={t('changes')}>{(['all', 'create', 'update', 'delete', 'conflict'] as const).map(kind => <button key={kind} className={filter === kind ? 'active' : ''} aria-pressed={filter === kind} onClick={() => { setFilter(kind); setPage(0); }}>{t(kind === 'all' ? 'all' : changeKey(kind))}<span>{number(kind === 'all' ? changes.length : changes.filter(c => kind === 'conflict' ? isPending(c) : c.kind === kind).length)}</span></button>)}</div><div className="p-search"><Search size={16} /><input aria-label={t('searchFiles')} placeholder={t('searchFiles')} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />{search && <button className="p-icon" aria-label={t('clearFilter')} onClick={() => setSearch('')}><X size={14} /></button>}</div></div>
      <div className="p-file-scroll"><div className="p-file-list" role="table" aria-label={t('changes')}>
        <div className="p-file-head" role="row"><span role="columnheader"><Checkbox label={t('selectFiltered')} checked={eligible.length > 0 && eligible.every(c => c.selected)} mixed={eligible.some(c => c.selected) && !eligible.every(c => c.selected)} disabled={busy || !eligible.length || !allowed} onChange={() => { const remove = eligible.every(c => c.selected); onUpdate({ ...task, changes: task.changes.map(c => eligible.includes(c) ? { ...c, selected: !remove } : c) }); }} /></span><span role="columnheader">{t('filename')}</span><span role="columnheader">{t('changes')}</span><span role="columnheader">{t('action')}</span><span className="p-size" role="columnheader">{t('size')}</span></div>
        {filtered.length ? [...groups].map(([dir, files]) => <div role="rowgroup" key={dir}><div className="p-directory"><Folder size={14} />{dir}</div>{files.map(c => <div className="p-file-row" key={c.path} role="row">
          <span role="cell"><Checkbox label={t('selectFile', { path: c.path })} checked={c.selected && isExecutable(c)} disabled={busy || !isExecutable(c) || !allowed} onChange={() => choose(c.path)} /></span>
          <span className="p-file-name" role="cell" title={c.path}>{/\.(md|txt|bib|csv|docx)$/i.test(c.path) ? <FileText size={18} /> : <File size={18} />}<span>{c.path.split('/').pop()}</span></span>
          <span role="cell" className={`p-change-label ${c.kind}`}>{t(c.kind === 'conflict' && c.resolution && c.resolution !== 'later' ? 'decided' : changeKey(c.kind))}</span>
          <span role="cell" className="p-file-action">{c.kind === 'conflict' ? <button className="p-link" aria-label={`${t('compare')} ${c.path}`} disabled={busy} onClick={() => onConflict(c.path)}>{isPending(c) ? <CircleHelp size={15} /> : c.target === 'local' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}{t(isPending(c) ? 'compare' : c.target === 'local' ? 'replaceLocal' : 'replaceRemote')}</button> : <>{targetOf(task, c) === 'local' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}{t(c.kind === 'delete' ? targetOf(task, c) === 'local' ? 'deleteLocal' : 'deleteRemote' : targetOf(task, c) === 'local' ? 'toLocal' : 'toRemote')}</>}</span>
          <span role="cell" className="p-size">{bytes(c.size)}</span>
        </div>)}</div>) : <div className="p-centered small"><Search size={29} /><h2>{t('noResults')}</h2><button className="p-link" onClick={() => { setFilter('all'); setSearch(''); }}>{t('clearFilter')}</button></div>}
      </div></div>
      {pages > 1 && <div className="p-pagination"><button aria-label={t('back')} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><span>{number(currentPage + 1)} / {number(pages)}</span><button aria-label={t('next')} disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></div>}
    </> : <div className="p-centered">{ignoredCount ? <Art kind="folder" /> : <SuccessMark />}<h2>{t(!task.online ? 'offline' : ignoredCount ? 'ignoredState' : 'ready')}</h2>{ignoredCount ? <p className="p-body-copy">{t('ignoredStateHelp')}</p> : <Help>{t('readyHelp')}</Help>}</div>}
  </div>;
}
export function TaskFooter({ task, busy, onExecute }: { task: DemoTask; busy: boolean; onExecute: () => void }) {
  const { t } = usePrototype(); const selected = chosenChanges(task); const pending = managedChanges(task).filter(isPending).length;
  const deletes = selected.filter(c => c.kind === 'delete').length;
  const blocked = !task.online || task.paused || task.risk || Boolean(task.problem) || busy || !selected.length;
  return <footer className="p-task-footer"><div><strong>{t('selectedCount', { n: selected.length })}</strong>{deletes > 0 ? <span className="p-danger-text">{t('deleteCount', { n: deletes })}</span> : pending > 0 && <span>{t('pendingCount', { n: pending })}</span>}</div><button className="primary" disabled={blocked} onClick={onExecute}><ShieldCheck size={17} />{t(canManage(task) ? 'sync' : 'pull')}</button></footer>;
}
function Endpoint({ name, path, local = false, online = true, onPath }: { name: string; path: string; local?: boolean; online?: boolean; onPath: () => void }) {
  const { t } = usePrototype(); const folder = path.split(/[\\/]/).filter(Boolean).at(-1);
  return <div className={`p-endpoint ${online ? '' : 'offline'}`}><Art kind={local ? 'laptop' : 'desktop'} size="large" /><strong>{name}</strong><button className="p-path-button" title={path} onClick={onPath}><Folder size={14} />{folder}</button><span className="p-endpoint-state">{t(local ? 'local' : online ? 'online' : 'offline')}</span></div>;
}
