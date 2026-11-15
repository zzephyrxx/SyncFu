import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleHelp, ExternalLink, Radio, RefreshCw, ShieldCheck, Wifi, XCircle } from 'lucide-react';
import { command, desktop, errorText } from './api';
import { Notice, Spinner } from './components';
import { t } from './i18n';

type Report = {
  platform: string;
  port: number;
  addresses: string[];
  listener_error: string | null;
  firewall: { private_network: boolean; syncfu_rule: boolean } | null;
};
type Feedback = { message: string; tone: 'success' | 'error' };

export default function PermissionCheck({ initialAddress }: { initialAddress: string }) {
  const [report, setReport] = useState<Report>();
  const [address, setAddress] = useState(initialAddress);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState<Feedback>();
  const [probe, setProbe] = useState<Feedback>();
  const started = useRef(false);
  const windows = report ? report.platform === 'windows' : /Win/.test(navigator.platform);

  const check = async () => setReport(await command<Report>('check_permissions'));
  const run = async (action: string, work: () => Promise<void>) => {
    setBusy(action);
    setFeedback(undefined);
    try { await work(); }
    catch (e) { setFeedback({ tone: 'error', message: errorText(e) }); }
    finally { setBusy(''); }
  };
  useEffect(() => {
    if (desktop && !started.current) {
      started.current = true;
      void run('check', check);
    }
  }, []);

  const firewall = report?.firewall;
  const row = (label: string, detail: string, state: 'ok' | 'issue' | 'unknown') => {
    const Icon = state === 'ok' ? CheckCircle2 : state === 'issue' ? XCircle : CircleHelp;
    return <div className="permission-row"><Icon size={17} data-status={state} aria-hidden="true" />
      <div><strong>{label}</strong><span>{detail}</span></div>
    </div>;
  };
  return <section className="panel permission-check" aria-labelledby="permissions-heading">
    <div className="permission-header">
      <div className="row-icon"><ShieldCheck size={19} /></div>
      <h2 id="permissions-heading">{t('权限检查')}</h2>
      <button disabled={!desktop || !!busy} onClick={() => void run('check', check)}>{busy === 'check' ? <Spinner /> : <RefreshCw size={15} />}{t('重新检查')}</button>
    </div>
    {report && <div className="permission-results enter-view">
      {row(t('本机监听'), report.listener_error ?? t('SyncFu 正在监听 TCP {port}', { port: report.port }), report.listener_error ? 'issue' : 'ok')}
      {row(t('本机局域网地址'), report.addresses.join(' · ') || t('未发现局域网 IPv4 地址'), report.addresses.length ? 'ok' : 'issue')}
      {windows ? <>
        {row(t('Windows 网络类型'), firewall ? t(firewall.private_network ? '检测到专用网络' : '未检测到专用网络，请检查当前 Wi-Fi 或以太网') : t('请在系统设置中核对网络类型'), firewall ? firewall.private_network ? 'ok' : 'issue' : 'unknown')}
        {row(t('SyncFu 防火墙规则'), firewall ? t(firewall.syncfu_rule ? '已允许专用网络的同网段入站连接' : '未发现此版本添加的规则，也可在系统防火墙中手动授权') : t('无法读取规则状态，可打开防火墙检查'), firewall?.syncfu_rule ? 'ok' : 'unknown')}
      </> : row(t('本地网络权限'), t('请在系统设置中允许 SyncFu 访问本地网络，随后测试对端地址。'), 'unknown')}
    </div>}
    <div className="permission-actions">
      <button disabled={!desktop || !!busy} onClick={() => void run('settings', () => command('open_permission_settings'))}>
        <ExternalLink size={15} />{t(windows ? '打开防火墙设置' : '打开本地网络权限')}
      </button>
      {windows && <button className="primary" disabled={!desktop || !!busy || !!firewall?.syncfu_rule} onClick={() => void run('firewall', async () => {
        await command('allow_private_lan');
        await check();
        setFeedback({ tone: 'success', message: t('已添加 SyncFu 专用网络规则。请在另一台设备上测试 Windows 的地址。') });
      })}>{busy === 'firewall' ? <Spinner /> : <ShieldCheck size={15} />}{t('允许专用网络入站')}</button>}
      {windows && !firewall?.syncfu_rule && <small>{t('需要 Windows 管理员确认。规则适用于 SyncFu 在专用网络上的同网段连接。')}</small>}
    </div>
    {feedback && <Notice tone={feedback.tone}>{feedback.message}</Notice>}
    <form className="permission-probe" onSubmit={event => {
      event.preventDefault();
      if (!address.trim() || busy) return;
      setProbe(undefined);
      void run('probe', async () => {
        try {
          const name = await command<string>('test_peer_address', { address });
          setProbe({ tone: 'success', message: t('已收到 {name} 的响应。请回到同步页发起连接。', { name }) });
        } catch (e) { setProbe({ tone: 'error', message: errorText(e) }); }
      });
    }}>
      <label htmlFor="permission-peer-address"><Radio size={16} />{t('测试对端连接')}</label>
      <div>
        <input id="permission-peer-address" value={address} onChange={event => { setAddress(event.target.value); setProbe(undefined); }} placeholder="192.168.1.20:47657" disabled={!desktop || !!busy} required />
        <button disabled={!desktop || !!busy || !address.trim()}>{busy === 'probe' ? <Spinner /> : <Wifi size={16} />}{t('测试连接')}</button>
      </div>
      {probe && <Notice tone={probe.tone}>{probe.message}</Notice>}
    </form>
  </section>;
}
