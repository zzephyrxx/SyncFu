"use client";
import { useEffect, useReducer, useRef, useState } from 'react';
import { Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import { Reel } from '../ui/DigitReels';
import { usePrototype } from './context';
import { Art, Dialog, Help, SuccessMark } from './UI';
import { motionTokens, useMotionAllowed } from './motion';
import { initialPairState, pairingPhase, pairingReducer } from './pairing';
import { remoteDevice } from './model';

export default function PairingDialog({ onClose, onPaired }: { onClose: () => void; onPaired?: () => void }) {
  const { t } = usePrototype(); const animate = useMotionAllowed();
  const [mode, setMode] = useState<'receive' | 'start'>('receive');
  const [state, dispatch] = useReducer(pairingReducer, initialPairState);
  const [now, setNow] = useState(Date.now); const [entry, setEntry] = useState('');
  const [copied, setCopied] = useState(false); const [error, setError] = useState(false);
  const generation = useRef(0); const alive = useRef(true); const phase = pairingPhase(state, now);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = () => {
    const digits = crypto.getRandomValues(new Uint32Array(5));
    dispatch({ type: 'generate', generation: ++generation.current, code: [...digits].map(n => n % 10).join('') });
    setCopied(false); setError(false); setNow(Date.now());
  };
  useEffect(() => { if (mode === 'receive') refresh(); }, [mode]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (state.phase !== 'spinning') return;
    const delay = animate ? (motionTokens.duration.crawl + motionTokens.duration.fast * 4) * 1000 + 40 : 0;
    const timer = window.setTimeout(() => { const stamp = Date.now(); dispatch({ type: 'settle', generation: state.generation, now: stamp }); setNow(stamp); }, delay);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.generation, animate]);
  const copy = async () => {
    if (pairingPhase(state, Date.now()) !== 'ready') return;
    const current = generation.current;
    try { await navigator.clipboard.writeText(state.code); if (alive.current && generation.current === current) setCopied(true); }
    catch { if (alive.current) setError(true); }
  };
  const complete = () => { if (onPaired) onPaired(); else onClose(); };
  return <Dialog title={t('pairTitle')} onClose={onClose}>
    <div className="p-pairing">
      <div className="p-segment" role="group" aria-label={t('connect')}>{(['receive', 'start'] as const).map(value => <button key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => { if (value === mode) return; dispatch({ type: 'reset' }); setMode(value); setCopied(false); setError(false); }}>{t(value === 'receive' ? 'receivePair' : 'startPair')}</button>)}</div>
      {state.phase === 'done' ? <div className="p-pair-success"><Art kind="laptop" size="large" /><SuccessMark /><h2>{t('paired')}</h2><p>{remoteDevice}</p><p className="p-body-copy">{t('simulationOnly')}</p><Help>{t('pairingHelp')}</Help><button className="primary" onClick={complete}>{t('done')}</button></div> : <>
        <div className="p-pair-orbit"><Art kind="laptop" /><span /><Art kind="desktop" /></div>
        {mode === 'receive' ? <>
          <h3 className="p-code-heading">{t(phase === 'expired' ? 'codeExpired' : phase === 'spinning' || phase === 'idle' ? 'rolling' : phase === 'pending' ? 'pairWaiting' : 'codeReady')}</h3>
          <div className={`p-code-machine ${phase === 'expired' ? 'expired' : ''}`} data-phase={phase}>
            <div className="p-reels" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <Reel key={`${state.generation}-${i}`} digit={Number(state.code[i] ?? 0)} index={i} animate={animate && phase === 'spinning'} expired={phase === 'expired'} />)}</div>
            <span className="p-machine-screw" /><span className="p-machine-screw right" />
          </div>
          <p className="p-code-announcement" aria-live="polite" aria-atomic="true">{phase === 'ready' ? `${t('pairCode')}: ${state.code.split('').join(' ')}` : t(phase === 'expired' ? 'codeExpired' : phase === 'pending' ? 'pairWaiting' : 'rolling')}</p>
          <div className="p-code-tools"><button onClick={refresh} disabled={phase === 'spinning'}><RefreshCw size={16} />{t('refreshCode')}</button><button onClick={() => void copy()} disabled={phase !== 'ready'}><Copy size={16} />{t(copied ? 'copied' : 'copyCode')}</button></div>
          <p className="p-code-timer">{phase === 'ready' || phase === 'pending' ? t('expiresIn', { n: Math.max(0, Math.ceil((state.expiresAt - now) / 1000)) }) : ' '}</p>
          {error && <p className="p-invalid" role="alert">{t('clipboardError')}</p>}
          {phase === 'pending' ? <div className="p-pair-request"><strong>{remoteDevice}</strong><button className="primary" onClick={() => dispatch({ type: 'approve', now: Date.now() })}>{t('pairApprove')}</button></div> : <button className="p-link" disabled={phase !== 'ready'} onClick={() => dispatch({ type: 'request', now: Date.now() })}>{t('pairRequest')}</button>}
        </> : <div className="p-pair-start">
          <label htmlFor="demo-pair-entry">{t('enterCode')}</label><input id="demo-pair-entry" autoComplete="off" inputMode="numeric" maxLength={5} value={entry} disabled={phase === 'pending'} onChange={e => setEntry(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="00000" />
          {phase === 'expired' && <p className="p-invalid" role="status">{t('codeExpired')}</p>}
          {phase === 'pending' ? <><p role="status">{t('pairWaiting')}</p><button className="primary" onClick={() => dispatch({ type: 'approve', now: Date.now() })}>{t('simulateApproval')}</button></> : <button className="primary" disabled={!/^\d{5}$/.test(entry)} onClick={() => { dispatch({ type: 'send', code: entry, now: Date.now() }); setNow(Date.now()); }}>{t('sendRequest')}</button>}
        </div>}
        <div className="p-pair-disclaimer"><ShieldCheck size={14} />{t('invalidDemoCode')}</div><Help>{t('pairingHelp')}</Help>
      </>}
    </div>
  </Dialog>;
}
