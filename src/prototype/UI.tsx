"use client";
import type { ReactNode } from 'react';
import { ArrowLeftRight, ArrowRight, Check, Folder, Laptop, Monitor, Shield, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Modal, Notice } from '../components';
import { usePrototype } from './context';
import { motionTokens, useMotionAllowed } from './motion';
import { isIgnored, isPending, localDevice, managedChanges, remoteDevice, type DemoTask } from './model';
import type { MessageKey } from './messages';
const art = {
  folder: new URL('../../assets/prototype/file_folder_3d.png', import.meta.url).href,
  laptop: new URL('../../assets/prototype/laptop_3d.png', import.meta.url).href,
  desktop: new URL('../../assets/prototype/desktop_computer_3d.png', import.meta.url).href,
  shield: new URL('../../assets/prototype/shield_3d.png', import.meta.url).href,
};
const fallback: Record<keyof typeof art, LucideIcon> = { folder: Folder, laptop: Laptop, desktop: Monitor, shield: Shield };
export function Art({ kind, size = 'normal' }: { kind: keyof typeof art; size?: 'small' | 'normal' | 'large' }) {
  const { prefs } = usePrototype(); const Icon = fallback[kind];
  return <span className={`p-art ${size}`} aria-hidden="true">{prefs.illustrations ? <img src={art[kind]} alt="" draggable={false} /> : <Icon strokeWidth={1.4} />}</span>;
}
export function Help({ children }: { children: ReactNode }) { const { prefs } = usePrototype(); return prefs.beginner ? <p className="p-help">{children}</p> : null; }
export function Dialog({ title, description, children, onClose, error, className }: { title: string; description?: string; children: ReactNode; onClose: () => void; error?: string; className?: string }) {
  const { t } = usePrototype();
  return <Modal title={title} description={description} closeLabel={t('close')} onClose={onClose} className={className}><div className="p-dialog">{error&&<Notice tone="error">{error}</Notice>}{children}</div></Modal>;
}
export function Direction({ task, running = false }: { task: DemoTask; running?: boolean }) {
  const allowed = useMotionAllowed(); const { t } = usePrototype();
  const relation = task.mode === 'both' ? `${localDevice} ↔ ${remoteDevice}` : task.source === 'local' ? `${localDevice} → ${remoteDevice}` : `${remoteDevice} → ${localDevice}`;
  const distance = task.mode !== 'both' && task.source === 'remote' ? -motionTokens.distance.sm : motionTokens.distance.sm;
  const Icon = task.mode === 'both' ? ArrowLeftRight : ArrowRight;
  return <div className="p-direction-art" data-running={running} role="img" aria-label={`${t(task.mode)}: ${relation}`}>
    <div className="p-direction-track" />
    <motion.span initial={false} animate={running && allowed ? { x: [0, distance, 0], opacity: [1, .45, 1] } : { x: 0, opacity: 1 }} transition={running && allowed ? { duration: motionTokens.duration.crawl, repeat: Infinity } : { duration: motionTokens.duration.fast }}><Icon size={24} style={task.mode !== 'both' && task.source === 'remote' ? { rotate: '180deg' } : undefined} /></motion.span>
    <span className="p-route-stud" /><span className="p-route-stud end" />
  </div>;
}
export function taskStatusKey(task: DemoTask): [MessageKey, Record<string, string | number>?] {
  if (!task.online) return ['offline']; if (task.paused) return ['paused'];
  if (task.problem === 'permission') return ['permission']; if (task.problem === 'partial') return ['partial'];
  if (task.risk) return ['risk']; const pending = managedChanges(task).filter(isPending).length;
  if (pending) return ['pendingCount', { n: pending }];
  if (managedChanges(task).some(c => !isIgnored(c))) return ['changes'];
  return managedChanges(task).some(isIgnored) ? ['ignoredState'] : ['ready'];
}
export function Status({ task }: { task: DemoTask }) { const { t } = usePrototype(); const [key, values] = taskStatusKey(task); return <>{t(key, values)}</>; }
export function SuccessMark() { const allowed = useMotionAllowed(); return <motion.span className="p-success-mark" initial={false} animate={{ scale: 1 }} transition={{ duration: allowed ? motionTokens.duration.normal : motionTokens.duration.instant }}><Check size={29} strokeWidth={2} /></motion.span>; }
