import { useState, type ReactNode } from 'react';
import { Bell, Check, Globe2, Info, Palette, RefreshCw, Search, ShieldCheck, Sparkles, SlidersHorizontal } from 'lucide-react';
import { Toggle } from '../components';
import { usePrototype } from './context';
import { languages, type MessageKey } from './messages';
import { Art, Dialog, Help } from './UI';
import type { Preferences } from './preferences';
const licenseUrl = new URL('../../assets/prototype/LICENSE.txt', import.meta.url).href;
const sections = [
  { key: 'general', icon: Globe2 }, { key: 'appearance', icon: Palette }, { key: 'syncDefaults', icon: SlidersHorizontal },
  { key: 'safety', icon: ShieldCheck }, { key: 'privacy', icon: Bell }, { key: 'about', icon: Info },
] as const;
export default function Settings({ clearUsage, live }: { clearUsage: () => void; live?: { safety: ReactNode; privacy: ReactNode; syncDefaults: ReactNode; about?: ReactNode } }) {
  const { prefs, setPref, resetPrefs, t, storageFailed } = usePrototype();
  const [section, setSection] = useState<(typeof sections)[number]['key']>('general');
  const [search, setSearch] = useState(''); const [confirm, setConfirm] = useState<'usage' | 'prefs' | null>(null);
  const match = (...keys: MessageKey[]) => !search.trim() || keys.some(key => t(key).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const show = (key: typeof section) => section === key || Boolean(search.trim());
  const row = (key: MessageKey, control: ReactNode, help?: MessageKey) => match(key, ...(help ? [help] : [])) ? <div className="p-setting" key={key}><div><label>{t(key)}</label>{help && <Help>{t(help)}</Help>}</div>{control}</div> : null;
  const toggle = (key: keyof Pick<Preferences, 'beginner' | 'illustrations' | 'defaultAuto' | 'confirmNormal' | 'successMessages' | 'usageEnabled'>, label: MessageKey, help?: MessageKey) => row(label, <Toggle label={t(label)} checked={prefs[key]} onChange={v => setPref(key, v)} />, help);
  const select = <K extends keyof Preferences>(key: K, label: MessageKey, choices: readonly (readonly [Preferences[K], MessageKey])[], help?: MessageKey) => row(label, <select aria-label={t(label)} value={String(prefs[key])} onChange={e => setPref(key, e.target.value as Preferences[K])}>{choices.map(([value, title]) => <option key={String(value)} value={String(value)}>{t(title)}</option>)}</select>, help);
  return <section className="p-settings-page">
    <div className="p-page-heading"><div><h1>{t('preferences')}</h1><Help>{t(live ? 'liveReset' : 'resetHelp')}</Help></div><Art kind="shield" /></div>
    <div className="p-settings-layout"><aside className="p-settings-nav"><div className="p-search"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} aria-label={t('searchSettings')} placeholder={t('searchSettings')} /></div><nav aria-label={t('settings')}>{sections.map(({ key, icon: Icon }) => <button key={key} className={section === key && !search ? 'active' : ''} onClick={() => { setSection(key); setSearch(''); }}><Icon size={18} />{t(key)}</button>)}</nav></aside>
      <div className="p-settings-content">
        {show('general') && <section><h2>{t('general')}</h2>
          {row('language', <select value={prefs.locale} aria-label={t('language')} onChange={e => setPref('locale', e.target.value as Preferences['locale'])}>{Object.entries(languages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>)}
          {toggle('beginner', 'beginner', 'beginnerHelp')}
          {select('startup', 'startup', [['tasks', 'tasks'], ['overview', 'overview']])}
          {row('resetPrefs', <button onClick={() => setConfirm('prefs')}><RefreshCw size={15} />{t('resetPrefs')}</button>)}
        </section>}
        {show('appearance') && <section><h2>{t('appearance')}</h2>
          {match('theme') && <div className="p-theme-setting"><label>{t('theme')}</label><div className="p-theme-choices">{(['light', 'dark', 'system'] as const).map(theme => <button className={`p-theme-swatch ${theme} ${prefs.theme === theme ? 'selected' : ''}`} aria-pressed={prefs.theme === theme} key={theme} onClick={() => setPref('theme', theme)}><span className="p-theme-window"><i /><i /><i /></span><strong>{t(theme)}</strong>{prefs.theme === theme && <Check size={14} />}</button>)}</div></div>}
          {select('density', 'density', [['comfortable', 'comfortable'], ['compact', 'compact']])}
          {row('accent', <div className="p-accent-choices">{(['violet', 'ocean', 'graphite'] as const).map(accent => <button key={accent} className={`p-accent-dot ${accent}`} aria-label={t(accent)} aria-pressed={prefs.accent === accent} onClick={() => setPref('accent', accent)}>{prefs.accent === accent && <Check size={14} />}</button>)}</div>)}
          {toggle('illustrations', 'illustrations', 'illustrationsHelp')}
          {select('motion', 'motion', [['full', 'full'], ['reduced', 'reduced'], ['off', 'off']], 'motionHelp')}
        </section>}
        {show('syncDefaults') && (live ? <section><h2>{t('syncDefaults')}</h2>{live.syncDefaults}</section> : <section><h2>{t('syncDefaults')}</h2>
          {select('defaultMode', 'defaultMode', [['both', 'both'], ['update', 'update'], ['mirror', 'mirror']])}
          {toggle('defaultAuto', 'defaultAuto', 'autoHelp')}
          {toggle('confirmNormal', 'confirmNormal', 'confirmHelp')}
          <div className="p-safety-strip"><ShieldCheck size={19} />{t('confirmHelp')}</div>
        </section>)}
        {show('safety') && (live ? <section><h2>{t('safety')}</h2>{live.safety}</section> : <section><h2>{t('safety')}</h2><p className="p-preset-badge">{t('presetOnly')}</p>
          {match('backupDays') && <NumberSetting label="backupDays" value={prefs.backupDays} min={1} max={3650} onSave={v => setPref('backupDays', v)} />}
          {match('quota') && <NumberSetting label="quota" value={prefs.backupQuota} min={1} max={10000} onSave={v => setPref('backupQuota', v)} />}
          {row('protectionOn', <ShieldCheck size={22} className="p-good-text" />)}
          <div className="p-safety-strip"><ShieldCheck size={19} />{t('backupFirst')}</div>
        </section>)}
        {show('privacy') && (live ? <section><h2>{t('privacy')}</h2>{live.privacy}</section> : <section><h2>{t('privacy')}</h2>
          {toggle('successMessages', 'successMessages', 'successHelp')}
          {toggle('usageEnabled', 'usageEnabled', 'usageHelp')}
          {row('clearUsage', <button onClick={() => setConfirm('usage')}>{t('clearUsage')}</button>)}
        </section>)}
        {show('about') && <section><h2>{t('about')}</h2><div className="p-about-logo"><Sparkles size={25} /><strong>SyncFu</strong><span>{live?'Focus':'P0 · 02'}</span></div><p>{t(live?'liveBoundary':'demoBoundary')}</p><p>{t('credits')}</p><a href="https://github.com/microsoft/fluentui-emoji" target="_blank" rel="noreferrer">Microsoft Fluent Emoji ↗</a><a href={licenseUrl} download="Microsoft-Fluent-Emoji-LICENSE.txt">MIT · Copyright Microsoft Corporation</a>{live?.about}</section>}
        {storageFailed ? <p className="p-storage-warning" role="status">{t('storageWarning')}</p> : <p className="p-save-indicator"><Check size={13} />{t(live?'localPrefsSaved':'setupSaved')}</p>}
      </div>
    </div>
    {confirm && <Dialog title={t(confirm === 'usage' ? 'clearUsage' : 'resetPrefs')} onClose={() => setConfirm(null)}><p className="p-body-copy">{t(confirm === 'usage' ? 'clearUsageHelp' : live ? 'liveReset' : 'resetHelp')}</p><div className="modal-actions"><button onClick={() => setConfirm(null)}>{t('cancel')}</button><button className="primary" onClick={() => { if (confirm === 'usage') clearUsage(); else resetPrefs(); setConfirm(null); }}>{t(confirm === 'usage' ? 'clearUsage' : 'resetPrefs')}</button></div></Dialog>}
  </section>;
}
function NumberSetting({ label, value, min, max, onSave }: { label: MessageKey; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const { t } = usePrototype(); const [draft, setDraft] = useState(String(value));
  const valid = /^\d+$/.test(draft) && Number(draft) >= min && Number(draft) <= max;
  return <div className="p-setting"><div><label htmlFor={`pref-${label}`}>{t(label)}</label><Help>{t('validRange', { min, max })}</Help>{!valid && <p className="p-invalid" role="alert">{t('invalidNumber')} ({t('validRange', { min, max })})</p>}</div><input id={`pref-${label}`} aria-invalid={!valid} type="number" min={min} max={max} step={1} value={draft} onChange={e => { setDraft(e.target.value); if (/^\d+$/.test(e.target.value) && Number(e.target.value) >= min && Number(e.target.value) <= max) onSave(Number(e.target.value)); }} /></div>;
}
