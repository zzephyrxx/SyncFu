import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { defaults, persistPreferences, readPreferences, type Preferences } from './preferences';
import { formatBytes, translate, type MessageKey, type Values } from './messages';
interface Context {
  prefs: Preferences; dark: boolean; storageFailed: boolean;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  resetPrefs: () => void; t: (key: MessageKey, values?: Values) => string;
  bytes: (n: number) => string; number: (n: number) => string;
  date: (timestamp: number, options?: Intl.DateTimeFormatOptions) => string;
}
const PreferencesContext = createContext<Context | null>(null);
export function PrototypeProvider({ children, mode = 'prototype' }: { children: ReactNode; mode?: 'prototype' | 'desktop' }) {
  const storageKey = mode === 'desktop' ? 'syncfu-desktop:v3:preferences' : 'syncfu-prototype:v2:preferences';
  const [prefs, setPrefs] = useState(() => { try { return readPreferences(window.localStorage, storageKey); } catch { return { ...defaults }; } });
  const [storageFailed, setStorageFailed] = useState(false);
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.prototype = 'v2'; document.documentElement.dataset.surface = mode; document.documentElement.dataset.accent = prefs.accent;
    document.documentElement.dataset.motion = prefs.motion; document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.material = prefs.material;
    document.documentElement.lang = prefs.locale;
  }, [dark, prefs.locale, prefs.accent, prefs.motion, prefs.material, mode]);
  useEffect(() => () => { delete document.documentElement.dataset.surface; delete document.documentElement.dataset.prototype; delete document.documentElement.dataset.accent; delete document.documentElement.dataset.motion; delete document.documentElement.dataset.material; }, []);
  useEffect(() => { try { setStorageFailed(!persistPreferences(window.localStorage, prefs, storageKey)); } catch { setStorageFailed(true); } }, [prefs]);
  return <PreferencesContext.Provider value={{ prefs, dark, storageFailed,
    setPref: (key, value) => setPrefs(old => ({ ...old, [key]: value })), resetPrefs: () => setPrefs({ ...defaults }),
    t: (key, values) => translate(prefs.locale, key, values), bytes: n => formatBytes(n, prefs.locale),
    number: n => new Intl.NumberFormat(prefs.locale).format(n),
    date: (timestamp, options = { month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat(prefs.locale, options).format(timestamp),
  }}>{children}</PreferencesContext.Provider>;
}
export function usePrototype() { const value = useContext(PreferencesContext); if (!value) throw new Error('Missing PrototypeProvider'); return value; }
