import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, File, FileText, Folder, Search, ShieldCheck, X } from 'lucide-react';
import type { Action, Change, Plan } from './types';
import { bytes, count, t } from './i18n';
import { Checkbox, Hint, Notice, Spinner, TooltipIcon } from './components';

export const defaultSelection = (plan: Plan) => new Set(plan.comparison.changes.filter(c => c.action === 'create' || c.action === 'update').map(c => c.path));
const names: Record<Action, string> = { create: '新增', update: '更新', delete: '删除', conflict: '冲突' };
interface Tree { name: string; path: string; folders: Map<string, Tree>; files: Change[] }
function treeOf(changes: Change[]) {
  const root: Tree = { name: '', path: '', folders: new Map(), files: [] };
  for (const change of changes) {
    const parts = change.path.split('/'); parts.pop(); let node = root;
    for (const name of parts) {
      const path = node.path ? `${node.path}/${name}` : name;
      if (!node.folders.has(name)) node.folders.set(name, { name, path, folders: new Map(), files: [] });
      node = node.folders.get(name)!;
    }
    node.files.push(change);
  }
  return root;
}
export default function DiffView({ plan, selected, onSelected, busy, localName, remoteName, onClose }: {
  plan: Plan; selected: Set<string>; onSelected: (value: Set<string>) => void; busy: boolean;
  localName: string; remoteName: string; onClose: () => void;
}) {
  const [filter, setFilter] = useState<Action | 'all'>('all'); const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(new Set<string>()); const [page, setPage] = useState(0);
  const comparison = plan.comparison;
  const totals = useMemo(() => {
    const counts = { create: 0, update: 0, delete: 0, conflict: 0 };
    for (const change of comparison.changes) counts[change.action]++;
    return counts;
  }, [comparison]);
  const filtered = useMemo(() => comparison.changes.filter(c => (filter === 'all' || c.action === filter) && c.path.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [comparison, filter, search]);
  const perPage = 100; const lastPage = Math.max(0, Math.ceil(filtered.length / perPage) - 1); const safePage = Math.min(page, lastPage);
  const tree = useMemo(() => treeOf(filtered.slice(safePage * perPage, (safePage + 1) * perPage)), [filtered, safePage]);
  const safeItems = filtered.filter(c => plan.undo_of ? c.action !== 'conflict' : c.action === 'create' || c.action === 'update');
  const safeSelected = safeItems.filter(c => selected.has(c.path)).length;
  const toggle = (path: string) => { const next = new Set(selected); if (next.has(path)) next.delete(path); else next.add(path); onSelected(next); };
  const toggleSafe = () => { const next = new Set(selected); const remove = safeSelected === safeItems.length; for (const c of safeItems) { if (remove) next.delete(c.path); else next.add(c.path); } onSelected(next); };
  const renderTree = (node: Tree, depth: number): ReactNode => <>
    {[...node.folders.values()].map(folder => <div key={folder.path}>
      <button className="folder-row" style={{ paddingLeft: 16 + Math.min(depth, 5) * 14 }} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(folder.path)) next.delete(folder.path); else next.add(folder.path); return next; })} aria-expanded={!collapsed.has(folder.path)}>
        {collapsed.has(folder.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<Folder size={16} /><span>{folder.name}</span>
      </button>{!collapsed.has(folder.path) && renderTree(folder, depth + 1)}
    </div>)}
    {node.files.map(change => {
      const isConflict = change.action === 'conflict'; const entry = change.after ?? change.before;
      const target = change.target === 0 ? localName : remoteName;
      return <div className={`file-row ${selected.has(change.path) ? 'selected' : ''}`} key={change.path}>
        <span className="file-check"><Checkbox label={t('选择 {path}', { path: change.path })} checked={selected.has(change.path)} disabled={busy || isConflict} onChange={() => toggle(change.path)} /></span>
        <div className="file-name" style={{ paddingLeft: Math.min(depth, 5) * 14 }} title={change.path}>{entry?.type === 'directory' ? <Folder size={16} /> : /\.(md|txt|docx|bib|csv)$/i.test(change.path) ? <FileText size={16} /> : <File size={16} />}<span>{change.path.split('/').pop()}</span></div>
        <span className={`change-tag ${change.action}`}>{t(plan.undo_of && isConflict ? '后续变化' : names[change.action])}</span>
        <span className="file-direction" title={isConflict ? t('不会覆盖任一设备的内容') : t('目标设备：{name}', { name: target })}>{isConflict ? <><CircleHelp size={13} />{t('暂不处理')}</> : <>{change.target === 0 ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}<span>{t(change.action === 'delete' ? '从 {device} 删除' : change.action === 'update' ? '更新 {device}' : '复制到 {device}', { device: change.target === 0 ? t('本机') : remoteName })}</span></>}</span>
        <span className="file-size">{entry?.type === 'file' ? bytes(entry.bytes) : '—'}</span>
      </div>;
    })}
  </>;
  const ratio = comparison.total > 0 ? (comparison.same / comparison.total) * 100 : 0;
  const complete = !comparison.issues.length;
  const measured = complete && !plan.undo_of && comparison.total > 0;
  const help = t('同路径且内容相同的文件，占两端可比较文件路径总数的比例。');

  return <section className="diff-view" aria-label={t(plan.undo_of ? '撤销预览' : '同步预览')}>
    <header className="diff-heading">
      <div>
        <h2>{t(plan.undo_of ? '撤销清单' : '变更清单')}</h2>
        <Hint>{t(plan.undo_of ? '同步后再次修改的文件会跳过。' : '新增和更新默认选中，删除须手动勾选。')}</Hint>
      </div>
      <div className="heading-actions">
        <button className="icon-button" aria-label={t('关闭预览')} onClick={onClose} disabled={busy}><X size={18} /></button>
      </div>
    </header>

    {!complete && <Notice tone="warning">
      <strong>{t('检查尚未完成，暂不能执行')}</strong>
      <ul className="issue-list">{comparison.issues.slice(0, 5).map((issue, i) => <li key={i}>{issue}</li>)}</ul>
      {comparison.issues.length > 5 && <span>{t('还有 {n} 项问题', { n: comparison.issues.length - 5 })}</span>}
    </Notice>}

    {!plan.undo_of && <div className="comparison-summary">
      <div className="similarity">
        <strong>{!complete ? '—' : measured ? `${ratio.toFixed(1)}%` : t('无文件')}</strong>
        <span>{t('内容一致率')}<TooltipIcon label={help}><CircleHelp size={14} /></TooltipIcon></span>
      </div>
      <div className="comparison-detail">
        {measured && <div className="similarity-meter" aria-hidden="true"><span style={{ width: `${ratio}%` }} /></div>}
        <div className="comparison-numbers">
          <span>{t('{same} / {total} 文件相同', { same: count(comparison.same), total: count(comparison.total) })}</span>
          {comparison.ignored > 0 && <span>{t('忽略 {n} 项', { n: count(comparison.ignored) })}</span>}
        </div>
      </div>
    </div>}

    <div className="diff-tools">
      <div className="filter-tabs" role="group" aria-label={t('筛选变化类型')}>
        {(['all', 'create', 'update', 'delete', 'conflict'] as const).map(value => <button
          key={value}
          aria-pressed={filter === value}
          className={filter === value ? 'active' : ''}
          onClick={() => { setFilter(value); setPage(0); }}
        >
          {t(value === 'all' ? '全部' : plan.undo_of && value === 'conflict' ? '后续变化' : names[value])}
          <span>{value === 'all' ? count(comparison.changes.length) : count(totals[value])}</span>
        </button>)}
      </div>
      <div className="search-field">
        <Search size={16} aria-hidden="true" />
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder={t('搜索文件')} aria-label={t('搜索文件路径')} />
        {search && <button className="icon-button clear-search" aria-label={t('清空搜索')} onClick={() => { setSearch(''); setPage(0); }}><X size={13} /></button>}
      </div>
    </div>

    <div className="file-table" role="region" aria-label={t('文件变化清单')} tabIndex={0}>
      <div className="file-table-head">
        <span className="file-check"><Checkbox
          label={t(plan.undo_of ? '选择当前结果中的可撤销项' : '选择当前结果中的新增和更新')}
          checked={safeItems.length > 0 && safeSelected === safeItems.length}
          mixed={safeSelected > 0 && safeSelected < safeItems.length}
          disabled={busy || safeItems.length === 0}
          onChange={toggleSafe}
        /></span>
        <span>{t('文件名称')}</span><span>{t('操作')}</span><span>{t('目标设备')}</span><span>{t('大小')}</span>
      </div>
      <div className="file-table-body">
        {filtered.length ? renderTree(tree, 0) : <div className="no-results">
          {complete && comparison.changes.length === 0 ? <Check size={22} /> : <Search size={22} />}
          <strong>{t(comparison.changes.length ? '未找到文件' : complete ? '文件已一致' : '检查未完成')}</strong>
          {comparison.changes.length > 0 && <Hint>{t('尝试其他筛选条件或文件名称。')}</Hint>}
        </div>}
      </div>
    </div>

    {lastPage > 0 && <div className="pagination">
      <span>{t('共 {n} 项', { n: count(filtered.length) })}</span>
      <button className="text-button" disabled={safePage === 0} onClick={() => setPage(p => p - 1)}>{t('上一页')}</button>
      <span>{safePage + 1} / {lastPage + 1}</span>
      <button className="text-button" disabled={safePage >= lastPage} onClick={() => setPage(p => p + 1)}>{t('下一页')}</button>
    </div>}
  </section>;
}

export function ReviewActions({ plan, selected, busy, blocked, onExecute }: {
  plan: Plan; selected: Set<string>; busy: boolean; blocked: boolean; onExecute: () => void;
}) {
  const comparison = plan.comparison;
  const chosen = comparison.changes.filter(c => selected.has(c.path) && c.action !== 'conflict');
  const selectedDeletes = chosen.filter(c => c.action === 'delete').length;
  const transfer = chosen.reduce((total, c) => total + (c.after?.type === 'file' ? c.after.bytes : 0), 0);
  return (
    <footer className="diff-footer">
      <div className="selection-summary">
        <div>
          <strong>{t('已选 {n} 项', { n: count(chosen.length) })}</strong>
          {transfer > 0 && <span>{bytes(transfer)}</span>}
        </div>
        {selectedDeletes > 0 && <p className="deletion-note">{t('含 {n} 项删除，将先备份。', { n: selectedDeletes })}</p>}
      </div>
      <button className="primary" onClick={onExecute} disabled={busy || blocked || chosen.length === 0 || plan.comparison.issues.length > 0}>
        {busy ? <Spinner /> : <ShieldCheck size={16} />}
        {t(plan.undo_of ? '备份并撤销' : '备份并同步')}
      </button>
    </footer>
  );
}
