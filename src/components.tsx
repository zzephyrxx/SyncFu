import { createContext, useContext, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import * as CheckBoxPrimitive from '@radix-ui/react-checkbox';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AlertCircle, ArrowLeftRight, Check, Folder, Laptop, LoaderCircle, Minus, X } from 'lucide-react';
import { t } from './i18n';

export const Guidance = createContext(false);

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return useContext(Guidance) ? <span className={className ? `hint ${className}` : 'hint'}>{children}</span> : null;
}

export function Spinner() {
  return <LoaderCircle size={16} className="spin" aria-hidden="true" />;
}

export function Empty({ icon, title, detail, children }: { icon?: ReactNode; title: string; detail: string; children?: ReactNode }) {
  return <div className="empty">
    <div className="empty-icon">{icon ?? <Folder size={28} strokeWidth={1.7} />}</div>
    <h2>{title}</h2>
    {detail && <Hint>{detail}</Hint>}
    {children && <div className="empty-actions">{children}</div>}
  </div>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' | 'warning' }) {
  const Icon = tone === 'success' ? Check : AlertCircle;
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
    <Icon size={17} aria-hidden="true" /><div>{children}</div>
  </div>;
}

export function Modal({ title, description, children, onClose, closeLabel, className = '' }: { title: string; description?: string; children: ReactNode; onClose: () => void; closeLabel?: string; className?: string }) {
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content
        className={`modal ${className}`}
        {...(!description && { 'aria-describedby': undefined })}
        onInteractOutside={event => event.preventDefault()}
        onCloseAutoFocus={event => {
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        <header className="modal-heading">
          <div>
            <Dialog.Title>{title}</Dialog.Title>
            {description && <Dialog.Description>{description}</Dialog.Description>}
          </div>
          <Dialog.Close className="icon-button" aria-label={closeLabel ?? t('关闭')}><X size={20} /></Dialog.Close>
        </header>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function Checkbox({ checked, mixed = false, disabled, onChange, label }: { checked: boolean; mixed?: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return <CheckBoxPrimitive.Root className="checkbox" checked={mixed ? 'indeterminate' : checked} disabled={disabled} onCheckedChange={onChange} aria-label={label}>
    <CheckBoxPrimitive.Indicator>{mixed ? <Minus size={13} /> : <Check size={13} />}</CheckBoxPrimitive.Indicator>
  </CheckBoxPrimitive.Root>;
}

export function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <Switch.Root className="switch" checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label}>
    <Switch.Thumb className="switch-thumb" />
  </Switch.Root>;
}

export function TooltipIcon({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Root>
    <Tooltip.Trigger type="button" className="icon-button inline-help" aria-label={label}>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content sideOffset={8} className="tooltip">{label}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>;
}

type Endpoint = { name: string; path: string };
export function SyncRoute({ local, remote, online = false, working = false }: { local: Endpoint; remote: Endpoint; online?: boolean; working?: boolean }) {
  return <section className="sync-route" data-working={working} aria-label={t('同步两端')}>
    <FolderEndpoint endpoint={local} roleLabel={t('本机')} />
    <div className="route-line" aria-label={t('双向同步')} role="img">
      <span className="route-arrow"><ArrowLeftRight size={19} /></span>
    </div>
    <FolderEndpoint endpoint={remote} roleLabel={online ? t('在线') : t('离线')} online={online} />
  </section>;
}

function FolderEndpoint({ endpoint, roleLabel, online }: { endpoint: Endpoint; roleLabel: string; online?: boolean }) {
  return <div className="endpoint">
    <div className="endpoint-icon"><Laptop size={21} strokeWidth={1.7} /></div>
    <div className="endpoint-body">
      <div className="endpoint-label">
        <strong title={endpoint.name}>{endpoint.name}</strong>
        <span className="endpoint-status">
          {online !== undefined && <i className={`connection-dot ${online ? 'online' : ''}`} />}
          {roleLabel}
        </span>
      </div>
      <div className="endpoint-path"><Folder size={14} /><span title={endpoint.path}>{endpoint.path}</span></div>
    </div>
  </div>;
}
