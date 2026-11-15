import './styles.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownUp, ArrowLeftRight, ArrowRight, Check, ChevronDown, Folder, FolderOpen, FolderPlus, History, Laptop, Monitor, Link2, Moon, RefreshCw, ScanLine, ShieldCheck, Sun, Unplug, Wifi, WifiOff } from 'lucide-react';
import { command, desktop, emptySnapshot, errorText, preview } from './api';
import { Empty, Guidance, Hint, Modal, Notice, Spinner, SyncRoute, Toggle } from './components';
import DiffView, { defaultSelection, ReviewActions } from './DiffView';
import { bytes, date, t } from './i18n';
import PairDialog, { PairShortcuts, type PairMode } from './PairDialog';
import PermissionCheck from './PermissionCheck';
import { previewPlan, previewSnapshot } from './preview';
import WindowToolbar from './WindowToolbar';
import type { Batch, Folder as FolderData, Page, Peer, Plan, Settings, Snapshot, Task } from './types';

type FolderList = { local: FolderData[]; remote: FolderData[] };
type Theme = 'system' | 'light' | 'dark';
const statuses: Record<string, string> = { completed: '已完成', partial: '部分完成', cancelled: '已取消', pending: '待核对', failed: '未执行' };

export default function App() {
  const [data, setData] = useState<Snapshot>(preview ? previewSnapshot : emptySnapshot);
  const [page, setPage] = useState<Page>('tasks');
  const [active, setActive] = useState<string>(preview ? previewPlan.task.id : '');
  const [plan, setPlan] = useState<Plan | null>(preview ? previewPlan : null);
  const [selected, setSelected] = useState(() => preview ? defaultSelection(previewPlan) : new Set<string>());
  const lastReview = useRef<{ plan: Plan; selected: Set<string> } | undefined>(undefined);
  useEffect(() => { if (plan) lastReview.current = { plan, selected }; }, [plan, selected]);
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  const [result, setResult] = useState<Batch | null>(null);
  const [pairing, setPairing] = useState<PairMode | null>(null);
  const [permissionAddress, setPermissionAddress] = useState('');
  const [taskPicker, setTaskPicker] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [showGuidance, setShowGuidance] = useState(() => localStorage.getItem('syncfu-show-guidance') === 'true');
  useEffect(() => {
    localStorage.setItem('syncfu-show-guidance', String(showGuidance));
  }, [showGuidance]);

  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('syncfu-theme');
    return stored === 'dark' || stored === 'light' ? stored : 'system';
  });

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try { setData(await command<Snapshot>('snapshot')); }
    catch (e) { setFailure(errorText(e)); }
  }, []);
  useEffect(() => {
    void refresh();
    if (!desktop) return;
    const timer = window.setInterval(() => void refresh(), 1100);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('syncfu-theme', theme);
  }, [theme]);

  const task = data.tasks.find(item => item.id === active) ?? data.tasks[0];
  const peer = data.peers.find(item => item.id === task?.peer);
  const openTask = (id: string) => {
    if (id !== task?.id) {
      setActive(id);
      setPlan(null);
      setResult(null);
    }
    setFailure('');
    setPage('tasks');
  };
  const go = (destination: Page) => { setPage(destination); setFailure(''); };
  const run = async (label: string, action: () => Promise<void>) => {
    setFailure(''); setBusy(label);
    try { await action(); await refresh(); }
    catch (e) { setFailure(errorText(e)); }
    finally { setBusy(''); }
  };

  const inspect = (taskId: string, undo?: string) => {
    const old = lastReview.current;
    void run(undo ? '正在检查撤销条件' : '正在扫描两个文件夹', async () => {
      const next = preview ? previewPlan : await command<Plan>(undo ? 'inspect_undo' : 'inspect_task', undo ? { batch: undo } : { task: taskId });
      const defaults = defaultSelection(next);
      if (old?.plan.task.id === next.task.id && old.plan.undo_of === next.undo_of) {
        const oldPaths = new Map(old.plan.comparison.changes.map(change => [change.path, change]));
        for (const change of next.comparison.changes) {
          if (oldPaths.has(change.path) && !old.selected.has(change.path)) defaults.delete(change.path);
          if (old.selected.has(change.path) && change.action === 'delete'
            && JSON.stringify(oldPaths.get(change.path)) === JSON.stringify(change)) defaults.add(change.path);
        }
      }
      setPlan(next); setSelected(defaults); setActive(next.task.id); setPage('tasks'); setResult(null);
    });
  };

  const execute = () => {
    setConfirmation(false);
    if (!plan) return;
    void run(plan.undo_of ? '正在撤销同步' : '正在准备同步', async () => {
      const batch = await command<Batch>('execute_plan', { plan: plan.id, digest: plan.digest, selected: [...selected] });
      setResult(batch); setPlan(null);
    });
  };

  const isWorking = Boolean(busy || data.phase);
  const pendingBatch = data.history.find(batch => batch.status === 'pending');
  const addTask = () => data.peers.length ? setTaskPicker(true) : setPairing('start');
  const reconcile = (batch: string) => void run('正在核对批次', async () => {
    setResult(await command<Batch>('reconcile', { batch }));
  });

  const review = page === 'tasks' && plan && plan.task.id === task?.id ? plan : null;
  const onlineCount = data.peers.filter(item => item.online).length;

  return <Guidance.Provider value={showGuidance}><div className="shell">
    <WindowToolbar
      page={page}
      task={task}
      tasks={data.tasks}
      changed={data.dirty}
      canAdd={desktop && !isWorking}
      onlineCount={onlineCount}
      pendingPair={data.pending.length > 0}
      onPage={go}
      onTask={openTask}
      onAdd={addTask}
      actions={<>
        {page === 'tasks' && task && <button
          className={`toolbar-scan ${review ? '' : 'primary'}`}
          aria-label={t(review ? '重新检查' : '检查变更')}
          title={t(review ? '重新检查' : '检查变更')}
          disabled={isWorking || (!desktop && !preview) || !!pendingBatch}
          onClick={() => inspect(task.id, review?.undo_of ?? undefined)}
        >
          {review ? <RefreshCw size={16} /> : <ScanLine size={17} />}
          <span>{t(review ? '重新检查' : '检查变更')}</span>
        </button>}
        <button
          className="icon-button theme-toggle"
          title={t('切换浅色或深色主题')}
          aria-label={t('切换浅色或深色主题')}
          onClick={() => {
            const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
            setTheme(dark ? 'light' : 'dark');
          }}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </>}
    />

    <main className="workspace">
      <div className={`content ${review ? 'with-review' : ''}`}>
        {preview && <p className="preview-note">{t('界面预览 · 示例数据')}</p>}
        {!desktop && !preview && <Notice>{t('连接设备请使用 SyncFu 桌面版。')}</Notice>}
        {data.network_error && <Notice tone="warning">{data.network_error}</Notice>}
        {failure && <Notice tone="error">{failure}</Notice>}
        {pairing !== 'receive' && data.pending.map(request => <Notice key={request.id}><div className="approval"><div><strong>{t('{name} 请求配对', { name: request.name })}</strong><p>{request.address}</p><Hint>{t('目录仍需单独授权。')}</Hint></div><div className="row-actions"><button disabled={isWorking} onClick={() => void run('正在拒绝请求', () => command('answer_pair', { id: request.id, accept: false }))}>{t('拒绝')}</button><button className="primary" disabled={isWorking} onClick={() => void run('正在确认配对', () => command('answer_pair', { id: request.id, accept: true }))}>{t('允许配对')}</button></div></div></Notice>)}
        {isWorking && <div className="progress-bar" role="status"><Spinner /><span>{data.phase || busy}</span>{pendingBatch && <button className="text-button" onClick={() => void command('cancel_batch').catch(e => setFailure(errorText(e)))}>{t('停止后续操作')}</button>}</div>}

        {page === 'tasks' && (task ? <>
          <div className="page-heading task-heading">
            <div className="task-heading-title">
              <h1>{task.label}</h1>
              {data.dirty.includes(task.id) && <span className="pill attention"><i className="attention-dot" />{t('有变更')}</span>}
            </div>
            <PairShortcuts compact disabled={!desktop} onPair={setPairing} />
          </div>
          <SyncRoute
            local={{ name: data.device.name, path: task.local_path }}
            remote={{ name: peer?.name ?? t('对端设备'), path: task.remote_path }}
            online={peer?.online}
            working={isWorking}
          />
          {result && result.task === task.id && <Notice tone={result.status === 'completed' ? 'success' : 'warning'}><strong>{t(statuses[result.status] ?? result.status)} · {result.done}/{result.total} {t('项')}</strong>{result.skipped > 0 && <span> · {t('跳过 {n} 项', { n: result.skipped })}</span>}{result.message && <p>{result.message}</p>}<div className="row-actions">
            {result.undo_available && <button className="text-button" disabled={isWorking || !!pendingBatch} onClick={() => inspect(result.task, result.id)}>{t('撤销这次同步')}</button>}
            <button className="text-button" onClick={() => go('history')}>{t('查看历史')}<ArrowRight size={14} /></button>
          </div></Notice>}
          {pendingBatch && !isWorking && <Notice tone="warning"><strong>{t('有批次等待两端核对')}</strong><p>{t('请连接原设备后核对，再开始下一批同步。')}</p><button className="text-button" onClick={() => reconcile(pendingBatch.id)}>{t('核对结果')}</button></Notice>}
          {review ? <DiffView plan={review} selected={selected} onSelected={setSelected} busy={isWorking} localName={data.device.name} remoteName={peer?.name ?? t('对端设备')} onClose={() => setPlan(null)} /> :
            <div className="quiet-card" data-working={isWorking}>
              <div className="row-icon"><ScanLine size={20} aria-hidden="true" /></div>
              <div className="quiet-card-copy"><strong>{t(isWorking ? '正在处理同步任务' : '检查文件变更')}</strong>
                <Hint>{t('检查只读取文件。确认清单后才会写入。')}</Hint></div>
              {!isWorking && <button onClick={() => inspect(task.id)} disabled={(!desktop && !preview) || !!pendingBatch}>
                {t('检查变更')}<ArrowRight size={15} />
              </button>}
            </div>}
        </> : <section className="home-empty enter-view">
          <div className="empty-route" aria-hidden="true">
            <span className="empty-terminal"><Laptop size={35} strokeWidth={1.5} /></span>
            <span className="route-line"><span className="route-arrow"><ArrowLeftRight size={20} /></span></span>
            <span className="empty-terminal awaiting"><Monitor size={35} strokeWidth={1.5} /></span>
          </div>
          <div className="home-empty-copy">
            <h1>{data.peers.length ? t('关联两个文件夹') : t('连接另一台设备')}</h1>
            <Hint>{data.peers.length
              ? t('分别在两台设备上授权文件夹，然后在这里关联。')
              : t('在同一局域网的两台设备上打开 SyncFu。')}</Hint>
            {data.peers.length > 0 && <button className="primary" onClick={addTask} disabled={!desktop}>
              <FolderPlus size={18} />{t('添加同步任务')}<ArrowRight size={16} />
            </button>}
          </div>
          <PairShortcuts disabled={!desktop} onPair={setPairing} />
        </section>)}

        {page === 'devices' && <><div className="page-heading">
          <h1>{t('设备')}</h1>
          <PairShortcuts compact disabled={!desktop} onPair={setPairing} />
        </div>
          <div className="device-local panel"><Laptop size={21} /><div><strong>{data.device.name || t('本机')}</strong><span>{data.device.port ? t('本机 · 监听端口 {port}', { port: data.device.port }) : t('本机')}</span></div><span className="pill">{t('当前设备')}</span></div>
          <h2 className="section-label">{t('已配对设备')}</h2>
          {data.peers.length ? data.peers.map(item => <DevicePanel key={item.id} peer={item} refresh={refresh} />) : <Empty icon={<Laptop size={30} />} title={t('暂无已配对设备')} detail={t('在任一设备发起连接，另一台设备显示动态码并确认。')} />}
        </>}

        {page === 'history' && <><div className="page-heading"><h1>{t('同步历史')}</h1></div>
          {data.history.length ? <div className="panel history-list">{data.history.map(item => <div className="history-row" key={item.id}>
            <div className="row-icon">{item.undo_of ? <History size={19} /> : <ArrowDownUp size={19} />}</div>
            <div className="history-detail"><strong>{item.label}</strong><span>{date(item.created)} · {item.undo_of ? t('撤销') : t('同步')} · {item.done}/{item.total} {t('项')}{item.skipped ? ' · ' + t('跳过 {n} 项', { n: item.skipped }) : ''}</span>{item.message && <span>{item.message}</span>}</div>
            <span className={'pill ' + (item.status === 'completed' ? 'positive' : item.status === 'pending' ? 'attention' : '')}>{t(statuses[item.status] ?? item.status)}</span>
            {item.status === 'pending' && <button onClick={() => reconcile(item.id)} disabled={isWorking}>{t('核对结果')}</button>}
            {item.undo_available && <button onClick={() => inspect(item.task, item.id)} disabled={!desktop || isWorking || !!pendingBatch}>{t('撤销这次同步')}</button>}
          </div>)}</div> : <Empty icon={<History size={30} />} title={t('还没有同步记录')} detail={t('完成一次同步后，可在这里查看结果与备份。')} />}
          {result && <Notice tone={result.status === 'completed' ? 'success' : 'info'}>{t(statuses[result.status] ?? result.status)} · {result.done}/{result.total} {t('项')}{result.message && ' · ' + result.message}</Notice>}
        </>}

        {page === 'settings' && <SettingsPage theme={theme} setTheme={setTheme} showGuidance={showGuidance} setShowGuidance={setShowGuidance} permissionAddress={permissionAddress} />}
      </div>
      <div className="review-actions">
        {review && <ReviewActions plan={review} selected={selected} busy={isWorking} blocked={!desktop || !!pendingBatch} onExecute={() => setConfirmation(true)} />}
      </div>
    </main>

    {pairing && <PairDialog mode={pairing} data={data} onClose={() => setPairing(null)} refresh={refresh}
      onPermissions={address => { setPermissionAddress(address); setPairing(null); go('settings'); }} />}
    {taskPicker && <TaskDialog peers={data.peers} onClose={() => setTaskPicker(false)} onCreate={async task => { await refresh(); openTask(task.id); setTaskPicker(false); }} />}
    {confirmation && plan && <Modal title={t(plan.undo_of ? '确认撤销' : '确认本次同步')} description={t('请先保存两台设备上正在编辑的相关文件。')} onClose={() => setConfirmation(false)}>
      <Notice tone={plan.comparison.changes.some(item => selected.has(item.path) && item.action === 'delete') ? 'warning' : 'info'}>{t('将执行 {n} 项已选操作。被覆盖和删除的内容会先备份。', { n: selected.size })}</Notice>
      <div className="modal-actions"><button onClick={() => setConfirmation(false)}>{t('返回清单')}</button><button className="primary" onClick={execute}><ShieldCheck size={16} />{t(plan.undo_of ? '确认并撤销' : '确认并同步')}</button></div>
    </Modal>}
  </div></Guidance.Provider>;
}

function DevicePanel({ peer, refresh }: { peer: Peer; refresh: () => Promise<void> }) {
  const [folders, setFolders] = useState<FolderData[] | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const load = async () => setFolders(await command<FolderData[]>('local_folders', { peer: peer.id }));
  return <div className="panel device-panel">
    <div className="device-row"><div className="row-icon"><Laptop size={19} /></div><div className="grow"><strong>{peer.name}</strong><span>{peer.address}</span></div><span className={'pill ' + (peer.online ? 'positive' : '')}>{peer.online ? <Wifi size={13} /> : <WifiOff size={13} />}{t(peer.online ? '在线' : '离线')}</span>
      <button onClick={() => void perform(async () => { const folder = await command<FolderData | null>('grant_folder', { peer: peer.id }); if (folder) await load(); })} disabled={!desktop || busy}><FolderPlus size={15} />{t('授权本机文件夹')}</button>
      <button className="icon-button" title={t('查看目录授权')} aria-label={t('查看目录授权')} onClick={() => folders ? setFolders(null) : void perform(load)} disabled={!desktop || busy}><ChevronDown size={17} /></button>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    {folders && <div className="grant-list">
      <span className="label">{t('已授权本机文件夹')}</span>
      {folders.length ? folders.map(folder => <div key={folder.id}><Folder size={15} /><span title={folder.path}>{folder.path}</span><button className="text-button" onClick={() => void perform(async () => { await command('revoke_folder', { id: folder.id }); setFolders(old => old?.filter(v => v.id !== folder.id) ?? null); })} disabled={busy}>{t('撤销授权')}</button></div>) : <small>{t('尚未授权文件夹')}</small>}
      <button className="text-button destructive" onClick={() => setConfirm(true)} disabled={busy}><Unplug size={15} />{t('解除配对')}</button>
    </div>}
    {confirm && <Modal title={t('解除配对')} description={t('此设备将失去访问已授权目录的权限，相关任务会被移除。')} onClose={() => setConfirm(false)}><div className="modal-actions"><button onClick={() => setConfirm(false)}>{t('取消')}</button><button className="danger" onClick={() => { setConfirm(false); void perform(() => command('forget_peer', { peer: peer.id })); }}>{t('解除配对')}</button></div></Modal>}
  </div>;
}

function TaskDialog({ peers, onClose, onCreate }: { peers: Peer[]; onClose: () => void; onCreate: (task: Task) => Promise<void> }) {
  const [peer, setPeer] = useState(peers[0]?.id ?? '');
  const [folders, setFolders] = useState<FolderList>({ local: [], remote: [] });
  const [local, setLocal] = useState('');
  const [remote, setRemote] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const read = useCallback(async () => {
    if (!peer) return;
    setChecking(true); setRemoteError('');
    try {
      const localFolders = await command<FolderData[]>('local_folders', { peer });
      setFolders(old => ({ ...old, local: localFolders }));
      setLocal(old => localFolders.some(item => item.id === old) ? old : localFolders[0]?.id ?? '');
    } catch (e) { setError(errorText(e)); }
    try {
      const { remote: remoteFolders } = await command<FolderList>('folders', { peer });
      setFolders(old => ({ ...old, remote: remoteFolders }));
      setRemote(old => remoteFolders.some(item => item.id === old) ? old : remoteFolders[0]?.id ?? '');
    } catch (e) {
      setFolders(old => ({ ...old, remote: [] }));
      setRemote('');
      setRemoteError(errorText(e));
    } finally { setChecking(false); }
  }, [peer]);
  useEffect(() => { void read(); }, [read]);
  return <Modal title={t('添加同步任务')} onClose={onClose}>
    {error && <Notice tone="error">{error}</Notice>}
    <form className="form" onSubmit={e => {
      e.preventDefault(); setBusy(true); setError('');
      void command<Task>('create_task', { peer, local, remote }).then(onCreate).catch(e => setError(errorText(e))).finally(() => setBusy(false));
    }}>
      <label>{t('对端设备')}<select value={peer} disabled={busy || checking} onChange={e => { setFolders({ local: [], remote: [] }); setLocal(''); setRemote(''); setError(''); setPeer(e.target.value); }}>{peers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>{t('本机文件夹')}<select value={local} disabled={busy} onChange={e => setLocal(e.target.value)}><option value="">{t('选择授权目录')}</option>{folders.local.map(item => <option value={item.id} key={item.id}>{item.path}</option>)}</select></label>
      <button type="button" className="text-button" disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void command<FolderData | null>('grant_folder', { peer }).then(item => {
          if (item) { setFolders(old => ({ ...old, local: [...old.local.filter(v => v.id !== item.id), item] })); setLocal(item.id); }
        }).catch(e => setError(errorText(e))).finally(() => setBusy(false));
      }}><FolderPlus size={15} />{t('授权新的本机文件夹')}</button>
      <label>{t('对端文件夹')}<select value={remote} disabled={busy || checking} onChange={e => setRemote(e.target.value)}><option value="">{t(checking ? '正在查询对端授权' : remoteError ? '无法读取对端文件夹' : '等待对端授权')}</option>{folders.remote.map(item => <option value={item.id} key={item.id}>{item.path}</option>)}</select></label>
      {remoteError && <Notice tone="error">{remoteError}</Notice>}
      <div className="form-help"><span>{!checking && !remoteError && !folders.remote.length && t('请在对端的「设备」页授权文件夹。')}</span><button type="button" className="text-button" onClick={() => void read()} disabled={busy || checking}><RefreshCw size={14} />{t('刷新')}</button></div>
      <div className="modal-actions"><button onClick={onClose} type="button">{t('取消')}</button><button className="primary" disabled={busy || checking || !local || !remote}><Link2 size={16} />{t('关联文件夹')}</button></div>
    </form>
  </Modal>;
}

function SettingsPage({ theme, setTheme, showGuidance, setShowGuidance, permissionAddress }: {
  theme: Theme; setTheme: (theme: Theme) => void;
  showGuidance: boolean; setShowGuidance: (enabled: boolean) => void;
  permissionAddress: string;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [days, setDays] = useState(30);
  const [quota, setQuota] = useState(10);
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'success' }>();
  const fill = (next: Settings) => { setSettings(next); setDays(next.days); setQuota(next.quota / 1_000_000_000); setAutostart(next.autostart); };
  useEffect(() => {
    if (desktop) void command<Settings>('settings').then(fill).catch(e => setNotice({ message: errorText(e), tone: 'error' }));
  }, []);
  const save = (chooseLocation: boolean) => {
    setBusy(true); setNotice(undefined);
    void command<Settings>('save_settings', { days, quota: Math.round(quota * 1_000_000_000), autostart, chooseLocation })
      .then(next => { fill(next); setNotice({ message: t('已保存设置'), tone: 'success' }); })
      .catch(e => setNotice({ message: errorText(e), tone: 'error' })).finally(() => setBusy(false));
  };
  const row = (title: string, detail: string, control: ReactNode) => <div className="setting-row"><div><strong>{t(title)}</strong><Hint>{t(detail)}</Hint></div>{control}</div>;
  return <><div className="page-heading"><h1>{t('设置')}</h1></div>
    {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
    <PermissionCheck initialAddress={permissionAddress} />
    <h2 className="section-label">{t('外观')}</h2>
    <div className="panel">
      {row('界面主题', '此设置仅应用于本机。', <select aria-label={t('界面主题')} value={theme} onChange={e => setTheme(e.target.value as Theme)}>
        <option value="system">{t('跟随系统')}</option>
        <option value="light">{t('浅色')}</option>
        <option value="dark">{t('深色')}</option>
      </select>)}
      {row('显示帮助说明', '在页面上显示操作说明和补充提示。', <Toggle
        label={t('显示帮助说明')}
        checked={showGuidance}
        onChange={setShowGuidance}
      />)}
    </div>
    <h2 className="section-label">{t('备份与运行')}</h2><form className="panel" onSubmit={e => { e.preventDefault(); save(false); }}>
      {row('备份保留天数', '过期且未被使用的备份将清理。', <input aria-label={t('备份保留天数')} type="number" min="1" max="3650" value={days} onChange={e => setDays(e.target.valueAsNumber || 1)} disabled={!settings || busy} />)}
      {row('备份空间上限（GB）', '超过额度时，相关覆盖和删除会停止。', <input aria-label={t('备份空间上限')} type="number" min="0.001" step="0.001" max="10000" value={quota} onChange={e => setQuota(e.target.valueAsNumber || 0.001)} disabled={!settings || busy} />)}
      <div className="setting-row">
        <div><strong>{t('备份位置')}</strong><span className="setting-path">{settings?.location ?? t('应用专用目录')}</span></div>
        <button type="button" disabled={!settings || busy} onClick={() => save(true)}><FolderOpen size={15} />{t('更改位置')}</button>
      </div>
      {row('开机自动启动', '后台发现变化后等待你的确认。', <Toggle label={t('开机自动启动')} checked={autostart} onChange={setAutostart} disabled={!settings || busy} />)}
      <div className="modal-actions"><button className="primary" disabled={!settings || busy}>{busy ? <Spinner /> : <Check size={16} />}{t('保存设置')}</button></div>
    </form>{settings?.updates_available && <div className="settings-update"><button onClick={() => void command('open_updates').catch(e => setNotice({ message: errorText(e), tone: 'error' }))}><RefreshCw size={14} />{t('查看发布版本')}</button></div>}<p className="settings-meta">SyncFu 0.1.0 · Apache-2.0 · {settings ? bytes(settings.quota) + ' ' + t('备份额度') : t('局域网同步')}</p></>;
}
