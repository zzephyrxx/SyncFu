import type { ReactNode } from 'react';
import { usePrototype } from '../prototype/context';
import { AppIcon } from './boardui/icons';
import { fileIdentity } from './focus-model';
import './sync-route.css';

export interface SyncRouteProps {
  localDevice: string;
  remoteDevice: string;
  localOriginalName?: string;
  remoteOriginalName?: string;
  localPath?: string;
  remotePath?: string;
  mode: 'both' | 'send' | 'receive';
  localContent?: ReactNode;
  remoteContent?: ReactNode;
  localIcon?: ReactNode;
  remoteIcon?: ReactNode;
  remoteOnline?: boolean;
}

/** Device identity and folder identity remain separate, even with long names. */
export function SyncRoute({ localDevice, remoteDevice, localOriginalName, remoteOriginalName, localPath, remotePath, mode, localContent, remoteContent, localIcon, remoteIcon, remoteOnline }: SyncRouteProps) {
  const { t, prefs } = usePrototype();
  const words = {
    'zh-CN': { local: '本机', remote: '对端', source: '发送端', destination: '接收端' },
    'zh-TW': { local: '本機', remote: '對端', source: '傳送端', destination: '接收端' },
    en: { local: 'This device', remote: 'Other device', source: 'Sending', destination: 'Receiving' },
    ja: { local: 'このデバイス', remote: '相手のデバイス', source: '送信側', destination: '受信側' },
    ko: { local: '이 기기', remote: '상대 기기', source: '보내는 기기', destination: '받는 기기' },
  };
  const copy = words[prefs.locale];
  const directionLabel = t(mode === 'both' ? 'directionBoth' : mode === 'send' ? 'sendOnly' : 'receiveOnly');
  const endpoint = (local: boolean) => {
    const name = local ? localDevice : remoteDevice;
    const originalName = local ? localOriginalName : remoteOriginalName;
    const path = local ? localPath : remotePath;
    const content = local ? localContent : remoteContent;
    const role = mode === 'both' ? '' : (mode === 'send') === local ? copy.source : copy.destination;
    return <div className={`sf-route-endpoint ${local ? 'is-local' : 'is-remote'}`}>
      <div className="sf-route-device">
        <span className="sf-route-device-icon" aria-hidden="true">{(local ? localIcon : remoteIcon) ?? <AppIcon name={local ? 'Laptop' : 'Monitor'} size={22}/>}</span>
        <div><span className="sf-route-role">{local ? copy.local : copy.remote}{role && <span>{role}</span>}</span><strong title={name}>{name}</strong>{originalName && originalName !== name && <small className="sf-route-original-name" title={originalName}>{originalName}</small>}</div>
        {!local && remoteOnline !== undefined && <span role="status" aria-label={t(remoteOnline ? 'online' : 'offline')} className={`sf-route-status ${remoteOnline ? 'online' : ''}`} title={t(remoteOnline ? 'online' : 'offline')}><i/><span>{t(remoteOnline ? 'online' : 'offline')}</span></span>}
      </div>
      {content ?? (path && <div className="sf-route-folder"><AppIcon name="Folder" size={17}/><div><strong>{fileIdentity(path).name || path}</strong><span title={path}>{path}</span></div></div>)}
    </div>;
  };
  return <div className="sf-route" data-direction={mode}>
    {endpoint(true)}
    <div className="sf-route-direction" aria-label={directionLabel} title={directionLabel}><AppIcon name={mode === 'both' ? 'ArrowLeftRight' : mode === 'send' ? 'ArrowRight' : 'ArrowLeft'} size={22}/><span>{directionLabel}</span></div>
    {endpoint(false)}
  </div>;
}
