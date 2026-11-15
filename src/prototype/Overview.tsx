import { useMemo, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { usePrototype } from './context';
import { summariseUsage, usageScale, type UsageEvent } from './usage';
import { Art, Help } from './UI';
export default function Overview({ events, onSettings, live = false, enabled }: { events: UsageEvent[]; onSettings: () => void; live?: boolean; enabled?: boolean }) {
  const { t, prefs, bytes, number, date } = usePrototype();
  const [range, setRange] = useState<7 | 30>(7); const [table, setTable] = useState(false); const [hovered, setHovered] = useState<number | null>(null); const [focused, setFocused] = useState<number | null>(null);
  const activeMark = hovered ?? focused;
  const report = useMemo(() => summariseUsage(events, range), [events, range]);
  const max=usageScale(report.rows.map(row=>row.bytes));
  return <section className="p-overview" aria-label={t('overview')}>
    <div className="p-page-heading"><div><h1>{t('overview')}</h1><Help>{t('usageTitle')}</Help></div><span className="p-pill">{t(live ? 'realStats' : 'sampleStats')}</span></div>
    {!(enabled ?? prefs.usageEnabled) ? <div className="p-centered"><Art kind="shield" size="large" /><h2>{t('statsOff')}</h2><button className="primary" onClick={onSettings}>{t('openSettings')}</button></div> : <>
      <div className="p-overview-filters"><div className="p-segment" role="group" aria-label={t('dateLabel')}>{([7, 30] as const).map(n => <button key={n} aria-pressed={range === n} className={range === n ? 'active' : ''} onClick={() => { setRange(n); setHovered(null); setFocused(null); }}>{t(n === 7 ? 'week' : 'month')}</button>)}</div><span className="p-date-span">{date(report.rows[0].timestamp)} — {date(report.rows.at(-1)!.timestamp)}</span></div>
      <div className="p-metrics" aria-label={t(live ? 'realStats' : 'sampleStats')}>
        <div className="p-main-metric"><span>{t('transferBytes')}</span><strong>{bytes(report.bytes)}</strong></div>
        <div><span>{t('syncCount')}</span><strong>{number(report.syncs)}</strong></div>
        <div><span>{t('fileCount')}</span><strong>{number(report.files)}</strong></div>
      </div>
      <div className="p-activity-heading"><div><h2>{t('activity')}</h2><span>{t('dailyBytes')}</span></div><button className="p-icon-label" aria-pressed={table} onClick={() => { setTable(!table); setHovered(null); setFocused(null); }}>{table ? <BarChart3 size={17} /> : <Table2 size={17} />}{t(table ? 'chart' : 'table')}</button></div>
      {!report.syncs ? <div className="p-centered"><Art kind="folder" /><h2>{t('noStats')}</h2></div> : table ? <div className="p-usage-table-wrap"><table className="p-usage-table"><thead><tr><th>{t('dateLabel')}</th><th>{t('syncCount')}</th><th>{t('fileCount')}</th><th>{t('transferBytes')}</th></tr></thead><tbody>{report.rows.map(row => <tr key={row.key}><td>{date(row.timestamp)}</td><td>{number(row.syncs)}</td><td>{number(row.files)}</td><td>{bytes(row.bytes)}</td></tr>)}</tbody></table></div> : <div className="p-chart-frame" role="group" aria-label={t('dailyBytes')}>
        <div className="p-chart-ticks">{[max, max / 2, 0].map(value => <span key={value}>{bytes(value)}</span>)}</div>
        <div className="p-chart-scroll"><div className="p-chart" style={{ minWidth: range * 28 }}>
          <div className="p-chart-grid" aria-hidden="true"><i /><i /><i /></div>
          <div className="p-chart-columns">{report.rows.map((row, i) => <button key={row.key} className={`p-bar-hit ${activeMark === i ? 'highlight' : ''}`} aria-label={`${date(row.timestamp)}: ${bytes(row.bytes)}, ${t('syncCount')} ${number(row.syncs)}`} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} onFocus={() => setFocused(i)} onBlur={() => setFocused(null)}>
            <span className="p-bar" style={{ height: `${row.bytes / max * 100}%` }} />
            {activeMark === i && <span className={`p-chart-tooltip ${i < 2 ? 'start' : i > report.rows.length - 3 ? 'end' : ''}`} role="tooltip"><strong>{bytes(row.bytes)}</strong><span>{date(row.timestamp)}</span></span>}
          </button>)}</div>
          <div className="p-chart-dates">{report.rows.map((row, i) => <span key={row.key}>{range === 7 || i % 5 === 0 || i === range - 1 ? date(row.timestamp, { month: 'numeric', day: 'numeric' }) : ''}</span>)}</div>
        </div></div>
      </div>}
      <Help>{t('usageHelp')}</Help>
    </>}
  </section>;
}
