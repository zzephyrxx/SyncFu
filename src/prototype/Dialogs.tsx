import { useState } from 'react';
import { ArrowLeftRight, ArrowRight, Check, ChevronLeft, FileText, Folder, ShieldAlert } from 'lucide-react';
import { Checkbox, Notice, Toggle } from '../components';
import { usePrototype } from './context';
import { Art, Dialog, Help, Status, SuccessMark } from './UI';
import PairingDialog from './PairingDialog';
import { canManage, canResolve, evaluateHandoff, isIgnored, localDevice, managedChanges, remoteDevice, type DemoChange, type DemoTask, type Mode, type Resolution } from './model';

export function TaskWizard({ onClose, onCreate }: { onClose: () => void; onCreate: (task: DemoTask) => void }) {
  const { t, prefs } = usePrototype();
  const [step, setStep] = useState(0); const [name, setName] = useState(() => t('defaultName'));
  const [localPath, setLocalPath] = useState('/Users/you/Documents/Work'); const [remotePath, setRemotePath] = useState('D:\\Documents\\Work');
  const [granted, setGranted] = useState(false); const [mode, setMode] = useState<Mode>(prefs.defaultMode);
  const [source, setSource] = useState<'local' | 'remote'>('local'); const [automatic, setAutomatic] = useState(prefs.defaultAuto);
  const [trust, setTrust] = useState<'personal' | 'shared'>('personal'); const [pairing, setPairing] = useState(false);
  if (pairing) return <PairingDialog onClose={() => setPairing(false)} onPaired={() => setPairing(false)} />;
  return <Dialog title={t('newTask')} onClose={onClose}>
    <ol className="p-steps" aria-label={t('newTask')}>{(['foldersStep', 'rulesStep', 'reviewStep'] as const).map((key, i) => <li key={key} aria-current={step === i ? 'step' : undefined} className={step === i ? 'active' : ''}><span>{i < step ? <Check size={13} /> : i + 1}</span>{t(key)}</li>)}</ol>
    {step === 0 ? <div className="p-form">
      <label>{t('taskName')}<input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
      <div className="p-device-choice"><Art kind="desktop" size="small" /><strong>{remoteDevice}</strong><button onClick={() => setPairing(true)}>{t('connect')}</button></div>
      <label>{t('localFolder')}<input value={localPath} onChange={e => setLocalPath(e.target.value)} /></label>
      <label>{t('remoteFolder')}<input value={remotePath} onChange={e => setRemotePath(e.target.value)} disabled={!granted} /></label>
      {!granted ? <div className="p-grant-wait"><Folder size={19} /><div><strong>{t('grantNeeded')}</strong><Help>{t('wizardHelp')}</Help><button className="p-link" onClick={() => setGranted(true)}>{t('grantDemo')}</button></div></div> : <p className="p-inline-good"><Check size={16} />{t('granted')}</p>}
    </div> : step === 1 ? <div className="p-form">
      <ModePicker mode={mode} source={source} onMode={setMode} onSource={setSource} />
      <div className="p-setting"><div><strong>{t('automatic')}</strong><Help>{t('autoHelp')}</Help></div><Toggle label={t('automatic')} checked={automatic} onChange={setAutomatic} /></div>
      <label>{t('relation')}<select value={trust} onChange={e => setTrust(e.target.value as 'personal' | 'shared')}><option value="personal">{t('personal')}</option><option value="shared">{t('shareOwner')}</option></select></label>
      {trust === 'shared' && <Notice>{t('wizardHelp')}</Notice>}
    </div> : <div className="p-form">
      <div className="p-wizard-summary"><Art kind="folder" /><h3>{name}</h3></div>
      <dl className="p-definition"><dt>{t('local')}</dt><dd>{localPath}</dd><dt>{t('remote')}</dt><dd>{remotePath}</dd><dt>{t('rulesStep')}</dt><dd>{t(mode)}{mode !== 'both' && ` · ${source === 'local' ? localDevice : remoteDevice}`}</dd><dt>{t('automatic')}</dt><dd>{t(automatic ? 'automatic' : 'manual')}</dd><dt>{t('relation')}</dt><dd>{t(trust === 'personal' ? 'personal' : 'shareOwner')}</dd></dl>
      <Notice tone={mode === 'mirror' ? 'warning' : 'info'}>{t(mode === 'both' ? 'bothHelp' : mode === 'update' ? 'updateHelp' : 'mirrorHelp')}</Notice>
      <Help>{t('simulationOnly')}</Help>
    </div>}
    <div className="modal-actions"><button onClick={step ? () => setStep(step - 1) : onClose}>{step > 0 && <ChevronLeft size={15} />}{t(step ? 'back' : 'cancel')}</button><button className="primary" disabled={step === 0 && (!name.trim() || !localPath.trim() || !remotePath.trim() || !granted)} onClick={() => step < 2 ? setStep(step + 1) : onCreate({ id: `demo-${crypto.randomUUID()}`, name: name.trim(), localPath, remotePath, mode, source, automatic, trust, owner: true, online: true, paused: false, risk: false, changes: [] })}>{t(step === 2 ? 'newTask' : 'next')}{step < 2 && <ArrowRight size={15} />}</button></div>
  </Dialog>;
}
export function ModePicker({ mode, source, onMode, onSource, disabled = false }: { mode: Mode; source: 'local' | 'remote'; onMode: (mode: Mode) => void; onSource: (source: 'local' | 'remote') => void; disabled?: boolean }) {
  const { t } = usePrototype();
  return <><fieldset className="p-mode-picker" disabled={disabled}><legend>{t('rulesStep')}</legend>{(['both', 'update', 'mirror'] as const).map(value => <label key={value} className={mode === value ? 'selected' : ''}><input type="radio" name="mode" value={value} checked={mode === value} onChange={() => onMode(value)} /><span><strong>{t(value)}</strong><Help>{t(value === 'both' ? 'bothHelp' : value === 'update' ? 'updateHelp' : 'mirrorHelp')}</Help></span>{value === 'both' ? <ArrowLeftRight size={20} /> : <ArrowRight size={20} />}</label>)}</fieldset>
    {mode !== 'both' && <label className="p-source-label">{t('source')}<select value={source} disabled={disabled} onChange={e => onSource(e.target.value as 'local' | 'remote')}><option value="local">{localDevice} → {remoteDevice}</option><option value="remote">{remoteDevice} → {localDevice}</option></select></label>}
  </>;
}
export function PolicyDialog({ task, onClose, onSave }: { task: DemoTask; onClose: () => void; onSave: (task: DemoTask) => void }) {
  const { t } = usePrototype(); const allowed = canManage(task);
  const [mode, setMode] = useState(task.mode); const [source, setSource] = useState(task.source); const [automatic, setAutomatic] = useState(task.automatic);
  return <Dialog title={t('rules')} description={task.name} onClose={onClose}><div className="p-form">
    {!allowed && <Notice tone="warning">{t('sharedHelp', { device: remoteDevice })}</Notice>}
    <ModePicker mode={mode} source={source} onMode={setMode} onSource={setSource} disabled={!allowed} />
    {mode !== 'both' && <Notice tone={mode === 'mirror' ? 'warning' : 'info'}>{t(mode === 'mirror' ? 'mirrorHelp' : 'updateHelp')}</Notice>}
    <div className="p-setting"><div><strong>{t('automatic')}</strong><Help>{t('autoHelp')}</Help></div><Toggle label={t('automatic')} checked={automatic} onChange={setAutomatic} disabled={!allowed} /></div>
    <div className="modal-actions"><button onClick={onClose}>{t(allowed ? 'cancel' : 'close')}</button>{allowed && <button className="primary" onClick={() => onSave({ ...task, mode, source, automatic, risk: mode === 'mirror' && task.changes.filter(c => c.kind === 'delete').length >= 100, changes: task.changes.map(c => c.kind === 'conflict' && !isIgnored(c) ? { ...c, resolution: undefined, selected: false } : c) })}>{t('save')}</button>}</div>
  </div></Dialog>;
}
export function ConflictDialog({ task, change, onClose, onResolve }: { task: DemoTask; change: DemoChange; onClose: () => void; onResolve: (r: Resolution) => void }) {
  const { t, bytes } = usePrototype(); const [skip, setSkip] = useState<Resolution>('later');
  return <Dialog title={t('compareTitle')} description={change.path} onClose={onClose}><div className="p-compare">
    <div className="p-compare-columns">{(['local', 'remote'] as const).map((side, i) => <section key={side}><header><Art kind={i ? 'desktop' : 'laptop'} size="small" /><strong>{i ? remoteDevice : localDevice}</strong><span>{t(task.mode !== 'both' && task.source === side ? 'source' : i ? 'remote' : 'local')}</span></header>
      {change.text ? <div className="p-code"><p><span>1</span># 工作交接</p><p><span>2</span></p><p className={i ? 'p-added' : 'p-removed'}><span>3</span>{i ? '下一步：补充 Windows 测试结果。' : '下一步：完成冲突处理的交互。'}</p><p><span>4</span>切换设备前保存正在编辑的文件。</p></div> : <dl className="p-file-meta"><dt>{t('size')}</dt><dd>{bytes((i ? change.remoteSize : change.localSize) ?? change.size)}</dd><dt>{t('fingerprint')}</dt><dd>{i ? '9cd4…17a2' : 'a1b8…5c09'}</dd></dl>}
    </section>)}</div>
    {!change.text && <p className="p-body-copy">{t('binaryHelp')}</p>}
    {!canManage(task) ? <Notice tone="warning">{t('sharedHelp', { device: remoteDevice })}</Notice> : <>
      {task.mode !== 'both' && <Notice>{t(task.mode === 'mirror' ? 'mirrorHelp' : 'updateHelp')}</Notice>}
      <div className="p-resolution-actions">{(['local', 'remote'] as const).map(side => <button key={side} disabled={!canResolve(task, side)} onClick={() => onResolve(side)}><ArrowRight size={16} style={side === 'remote' ? { rotate: '180deg' } : undefined} />{t('useVersion', { device: side === 'local' ? localDevice : remoteDevice })}</button>)}</div>
      <div className="p-skip-row"><select aria-label={t('noAction')} value={skip} onChange={e => setSkip(e.target.value as Resolution)}><option value="later">{t('later')}</option><option value="version">{t('ignoreVersion')}</option><option value="exclude">{t('exclude')}</option></select><button onClick={() => onResolve(skip)}>{t('apply')}</button></div>
      <Help>{t(skip === 'later' ? 'laterHelp' : skip === 'version' ? 'ignoreHelp' : 'excludeHelp')}</Help>
    </>}
    <div className="modal-actions"><button onClick={onClose}>{t('back')}</button></div>
  </div></Dialog>;
}
export function RiskDialog({ task, onClose, onApprove }: { task: DemoTask; onClose: () => void; onApprove: () => void }) {
  const { t } = usePrototype(); const [approved, setApproved] = useState(false); const deletions = managedChanges(task).filter(c => c.kind === 'delete' && !isIgnored(c));
  return <Dialog title={t('risk')} onClose={onClose}><div className="p-risk-heading"><Art kind="shield" /><h2>{t('riskTitle', { n: deletions.length })}</h2></div><p className="p-body-copy">{t('riskHelp')}</p>
    <div className="p-risk-list">{deletions.slice(0, 5).map(c => <div key={c.path}><FileText size={16} />{c.path}</div>)}{deletions.length > 5 && <span>{t('moreFiles', { n: deletions.length - 5 })}</span>}</div>
    <label className="p-consent"><Checkbox checked={approved} onChange={() => setApproved(!approved)} label={t('consent')} /><span>{t('consent')}</span></label><p className="p-body-copy">{t('backupFirst')}</p>
    <div className="modal-actions"><button onClick={onClose}>{t('remainPaused')}</button><button className="p-danger" disabled={!approved || !canManage(task)} onClick={onApprove}>{t('approveOnce')}</button></div>
  </Dialog>;
}
export function HandoffDialog({ tasks, onClose }: { tasks: DemoTask[]; onClose: () => void }) {
  const { t } = usePrototype(); const [selected, setSelected] = useState(new Set(tasks.map(task => task.id))); const [checked, setChecked] = useState(false);
  const { ignored: ignoredCount, wrongDirection, blocked: problem } = evaluateHandoff(tasks.filter(task => selected.has(task.id)));
  return <Dialog title={t('handoff')} description={t('handoffTarget', { device: remoteDevice })} onClose={onClose}>
    {checked ? <div className="p-handoff-result">{problem || ignoredCount ? <Art kind="folder" size="large" /> : <SuccessMark />}<h2>{t(problem ? 'handoffBlocked' : ignoredCount ? 'ignoredState' : 'ready')}</h2>{problem ? <p>{t(wrongDirection ? 'handoffDirectionHelp' : 'handoffHelp')}</p> : ignoredCount > 0 && <p>{t('ignoredStateHelp')}</p>}</div> : <div className="p-handoff-list">{tasks.map(task => <label key={task.id}><Checkbox label={task.name} checked={selected.has(task.id)} onChange={() => setSelected(old => { const n = new Set(old); if (n.has(task.id)) n.delete(task.id); else n.add(task.id); return n; })} /><Art kind="folder" size="small" /><div><strong>{task.name}</strong><span>{task.mode !== 'both' && task.source === 'remote' ? t('directionBlocked') : <Status task={task} />}</span></div>{!task.online || task.paused || task.risk || task.problem || managedChanges(task).length > 0 || (task.mode !== 'both' && task.source === 'remote') ? <ShieldAlert size={18} /> : <Check size={18} />}</label>)}</div>}
    <div className="modal-actions"><button onClick={onClose}>{t(checked ? 'back' : 'cancel')}</button>{!checked && <button className="primary" disabled={!selected.size} onClick={() => setChecked(true)}>{t('checkHandoff')}</button>}</div>
  </Dialog>;
}
export function IgnoredDialog({ task, onClose, onRestore }: { task: DemoTask; onClose: () => void; onRestore: (path: string) => void }) {
  const { t } = usePrototype(); const ignored = task.changes.filter(isIgnored);
  return <Dialog title={t('ignored')} onClose={onClose}>
    {ignored.length ? ignored.map(c => <div className="p-ignored-row" key={c.path}><FileText size={19} /><div><strong>{c.path}</strong><span>{t(c.resolution === 'exclude' ? 'exclude' : 'ignoreVersion')}</span></div><button disabled={!canManage(task)} onClick={() => onRestore(c.path)}>{t(c.resolution === 'exclude' ? 'undoExclude' : 'undoIgnore')}</button></div>) : <div className="p-centered small"><Art kind="shield" /><h2>{t('ignoredEmpty')}</h2></div>}
    <div className="modal-actions"><button onClick={onClose}>{t('done')}</button></div>
  </Dialog>;
}
