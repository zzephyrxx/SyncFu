import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Copy, Laptop, Link2, RefreshCw, Wifi } from 'lucide-react';
import { command, errorText } from './api';
import { Hint, Modal, Notice, Spinner } from './components';
import { t } from './i18n';
import type { Snapshot } from './types';

export type PairMode = 'start' | 'receive';
type Invite = { code: string; expires_at: number };
const codeLength = 5;

export function PairShortcuts({ disabled, compact = false, onPair }: {
  disabled: boolean;
  compact?: boolean;
  onPair: (mode: PairMode) => void;
}) {
  return <div className={compact ? 'pair-shortcuts compact' : 'pair-shortcuts'}>
    {(['start', 'receive'] as const).map(mode => {
      const start = mode === 'start';
      return <button key={mode} onClick={() => onPair(mode)} disabled={disabled}>
        <span className="pair-shortcut-icon">{start ? <ArrowUpRight size={21} /> : <ArrowDownLeft size={21} />}</span>
        <span><strong>{t(start ? '发起连接' : '等待连接')}</strong>
          {!compact && <Hint>{t(start ? '输入对端的动态码' : '显示本机的动态码')}</Hint>}
        </span>
        {!compact && <ArrowRight className="pair-shortcut-arrow" size={16} />}
      </button>;
    })}
  </div>;
}

function CodeCells({ value }: { value: string }) {
  return <span className="code-cells" aria-hidden="true">
    {Array.from({ length: codeLength }, (_, index) => <span key={index} data-filled={Boolean(value[index])}>{value[index] ?? '·'}</span>)}
  </span>;
}

export default function PairDialog({ mode, data, onClose, onPermissions, refresh }: {
  mode: PairMode;
  data: Snapshot;
  onClose: () => void;
  onPermissions: (address: string) => void;
  refresh: () => Promise<void>;
}) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [approvedPeer, setApprovedPeer] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const inviteRequested = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const paired = sent || Boolean(approvedPeer && data.peers.some(peer => peer.id === approvedPeer));
  const hasRequest = data.pending.length > 0;

  const receive = useCallback(async () => {
    setBusy(true);
    setError('');
    setCopied(false);
    try { setInvite(await command<Invite>('invite')); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (mode === 'receive' && !inviteRequested.current) {
      inviteRequested.current = true;
      if (!hasRequest) void receive();
    }
  }, [mode, receive, hasRequest]);
  useEffect(() => {
    if (!invite) { setSeconds(0); return; }
    const tick = () => setSeconds(Math.max(0, Math.ceil(invite.expires_at - Date.now() / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [invite]);
  useEffect(() => {
    if (!approvedPeer || paired) return;
    const timer = window.setTimeout(() => {
      setApprovedPeer('');
      setError(t('对端未完成身份核验。请生成新码后重试。'));
    }, 16_000);
    return () => window.clearTimeout(timer);
  }, [approvedPeer, paired]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || code.length !== codeLength || !address.trim()) return;
    setBusy(true);
    setError('');
    try { await command('pair', { address, code, deviceId }); setSent(true); await refresh(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const respond = async (id: string, accept: boolean) => {
    setBusy(true);
    setError('');
    try {
      await command('answer_pair', { id, accept });
      setInvite(null);
      if (accept) setApprovedPeer(id);
      await refresh();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const visibleCode = !hasRequest && !approvedPeer && seconds > 0 ? invite?.code : undefined;
  const copyCode = async () => {
    if (!visibleCode) return;
    try { await navigator.clipboard.writeText(visibleCode); setCopied(true); }
    catch { setError(t('无法访问剪贴板，请手动输入屏幕上的动态码。')); }
  };

  return <Modal title={t(mode === 'start' ? '发起连接' : '等待连接')} onClose={onClose}>
    {error && <Notice tone="error">
      <p>{error}</p>
      {mode === 'start' && (error.includes('权限检查') || error.includes('无法连接')) &&
        <button className="text-button" onClick={() => onPermissions(address)}>{t('检查连接权限')}<ArrowRight size={14} /></button>}
    </Notice>}
    {paired ? <div className="pair-success enter-view">
      <span className="pair-success-icon"><Check size={29} /></span>
      <h2>{t('配对成功')}</h2>
      <Hint>{t('接下来可分别在两台设备上授权文件夹。')}</Hint>
      <button className="primary" onClick={onClose}>{t('完成')}</button>
    </div> : mode === 'receive' ? <>
      <div className="pair-code">
        <div className="pair-code-status" role="status">
          {approvedPeer || busy ? <Spinner /> : <Wifi size={16} className={visibleCode ? 'waiting-signal' : undefined} />}
          {t(approvedPeer ? '正在核验设备身份' : hasRequest ? '收到配对请求' : busy ? '正在处理' : visibleCode ? '请在另一台设备输入动态码' : '动态码已失效')}
        </div>
        <div role="group" aria-label={visibleCode ? t('动态码 {code}', { code: [...visibleCode].join(' ') }) : t('暂无动态码')}>
          <CodeCells value={visibleCode ?? ''} />
        </div>
        {visibleCode && <div className="pair-code-footer">
          <span>{t('{n} 秒后过期', { n: seconds })}</span>
          <button type="button" className="text-button" onClick={() => void copyCode()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}{t(copied ? '已复制' : '复制动态码')}
          </button>
        </div>}
      </div>
      {hasRequest && data.pending.map(item => <div className="device-row pair-request enter-view" key={item.id}>
        <div className="row-icon"><Laptop size={19} /></div><div className="grow"><strong>{item.name}</strong><span>{item.address}</span></div>
        <button disabled={busy} onClick={() => void respond(item.id, false)}>{t('拒绝')}</button>
        <button className="primary" disabled={busy} onClick={() => void respond(item.id, true)}>{t('允许配对')}</button>
      </div>)}
      {!!data.device.addresses?.length && <div className="pair-addresses"><span>{t('本机地址')}</span>
        {data.device.addresses.map(value => <code key={value}>{value}</code>)}
      </div>}
      <div className="modal-actions"><button disabled={busy || hasRequest || !!approvedPeer} onClick={() => void receive()}><RefreshCw size={15} />{t('生成新码')}</button></div>
    </> : <form className="form pair-form" onSubmit={send}>
      <div className="nearby-list"><span className="label">{t('附近设备')}</span>
        {data.nearby.length ? data.nearby.map(item => <button type="button" key={item.id} disabled={busy} onClick={() => {
          setAddress(item.address); setDeviceId(item.id); codeInput.current?.focus();
        }} aria-pressed={deviceId === item.id}>
          <Laptop size={17} /><span>{item.name}</span><small>{item.address}</small>{deviceId === item.id && <Check size={15} />}
        </button>) : <small>{t('暂无附近设备，可手动输入地址')}</small>}
      </div>
      <label>{t('设备地址')}<input value={address} onChange={e => { setAddress(e.target.value); setDeviceId(null); }} placeholder="192.168.1.20:47657" disabled={busy} required /></label>
      <label>{t('5 位动态码')}
        <span className="code-entry">
          <CodeCells value={code} />
          <input ref={codeInput} inputMode="numeric" autoComplete="one-time-code" value={code} disabled={busy}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, codeLength))} required />
        </span>
      </label>
      <div className="modal-actions pair-submit">
        {busy && <span role="status">{t('请留意对端的确认提示')}</span>}
        <button type="submit" className="primary" disabled={busy || code.length !== codeLength || !address.trim()}>
          {busy ? <Spinner /> : <Link2 size={16} />}{t(busy ? '正在连接' : '发送配对请求')}
        </button>
      </div>
    </form>}
  </Modal>;
}
