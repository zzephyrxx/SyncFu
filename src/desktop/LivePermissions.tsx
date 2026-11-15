import { useState } from 'react';
import { CheckCircle2, ExternalLink, ShieldCheck } from './ui/glyphs';
import { Notice } from './ui/UI';
import { usePrototype } from '../prototype/context';
import type { DesktopController } from './controller';
type Report={platform:string;port:number;addresses:string[];listener_error:string|null;firewall:{private_network:boolean;syncfu_rule:boolean}|null};
export function LivePermissions({c}:{c:DesktopController}){
  const {t}=usePrototype();const [report,setReport]=useState<Report|null>(null);const [address,setAddress]=useState('');const [probe,setProbe]=useState('');
  const check=()=>c.run(async()=>setReport(await c.transport<Report>('check_permissions')));
  return <section className="live-permissions"><div className="ui-setting"><strong>{t('networkCheck')}</strong><button disabled={c.busy} onClick={()=>void check()}>{t('check')}</button></div>
    {report&&<dl className="ui-definition"><dt>{t('listener')}</dt><dd>{report.listener_error??`TCP ${report.port} ✓`}</dd><dt>{t('address')}</dt><dd>{report.addresses.join(' / ')||'—'}</dd>{report.firewall&&<><dt>{t('networkType')}</dt><dd>{t(report.firewall.private_network?'yes':'no')} / {t(report.firewall.syncfu_rule?'yes':'no')}</dd></>}</dl>}
    <div className="live-permission-actions"><button disabled={c.busy} onClick={()=>void c.run(async()=>{await c.transport('open_permission_settings');})}><ExternalLink size={16}/>{t('openPermissions')}</button>{report?.platform==='windows'&&<button disabled={c.busy||report.firewall?.syncfu_rule} onClick={()=>void c.run(async()=>{await c.transport('allow_private_lan');setReport(await c.transport('check_permissions'));})}><ShieldCheck size={16}/>{t('allowLan')}</button>}</div>
    {report?.platform==='windows'&&<p className="ui-body-copy">{t('firewallConsent')}</p>}
    <form className="ui-form" onSubmit={e=>{e.preventDefault();setProbe('');void c.run(async()=>{setProbe(await c.transport<string>('test_peer_address',{address}));});}}><label>{t('probeConnection')}<input required aria-label={t('address')} placeholder="192.168.1.20:47657" value={address} onChange={e=>{setAddress(e.target.value);setProbe('');}}/></label><button disabled={c.busy||!address.trim()}>{t('check')}</button></form>{probe&&<Notice tone="success"><CheckCircle2 size={16}/>{probe}</Notice>}
  </section>;
}
