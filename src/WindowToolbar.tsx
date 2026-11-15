import { useEffect, useState, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowLeftRight, Check, ChevronsUpDown, Folder, History, Laptop, Plus, Settings2 } from 'lucide-react';
import { desktop } from './api';
import { t } from './i18n';
import type { Page, Task } from './types';

const isMac = /Mac/.test(navigator.platform);
const sections = [
  { id: 'tasks', label: '同步任务', shortLabel: '同步', icon: ArrowLeftRight },
  { id: 'devices', label: '设备', shortLabel: '设备', icon: Laptop },
  { id: 'history', label: '同步历史', shortLabel: '历史', icon: History },
  { id: 'settings', label: '设置', shortLabel: '设置', icon: Settings2 },
] as const;

type Props = {
  page: Page;
  task?: Task;
  tasks: Task[];
  changed: string[];
  canAdd: boolean;
  onlineCount: number;
  pendingPair: boolean;
  actions: ReactNode;
  onPage: (page: Page) => void;
  onTask: (id: string) => void;
  onAdd: () => void;
};

export default function WindowToolbar({
  page, task, tasks, changed, canAdd, onlineCount, pendingPair, actions, onPage, onTask, onAdd,
}: Props) {
  const [taskMenu, setTaskMenu] = useState(false);
  const shortcut = isMac ? '⌘ K' : 'Ctrl K';

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const command = isMac ? event.metaKey : event.ctrlKey;
      if (!desktop || !command || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k'
        || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setTaskMenu(open => !open);
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  return (
    <header className={`window-toolbar ${desktop && isMac ? 'native-mac' : ''}`}>
      <div className="toolbar-grab" data-tauri-drag-region={desktop ? '' : undefined} aria-hidden="true" />
      <div className="toolbar-context">
        <Menu.Root open={taskMenu} onOpenChange={setTaskMenu}>
          <Menu.Trigger
            className="task-trigger"
            aria-label={t('{name}，切换同步任务', { name: task?.label ?? t('同步任务') })}
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            title={t('切换同步任务 · {shortcut}', { shortcut })}
          >
            <Folder size={17} />
            <span>{task?.label ?? t('同步任务')}</span>
            <ChevronsUpDown size={13} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="task-menu" align="start" sideOffset={9} collisionPadding={12}>
              <Menu.Label className="menu-label">{t('同步任务')}<kbd>{shortcut}</kbd></Menu.Label>
              {tasks.length > 0 ? <Menu.RadioGroup value={task?.id ?? ''}>
                {tasks.map(item => (
                  <Menu.RadioItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => onTask(item.id)}
                    className="task-menu-item"
                    textValue={item.label}
                  >
                    <Folder size={16} />
                    <span>{item.label}</span>
                    {changed.includes(item.id) && <i className="attention-dot" aria-label={t('有变更')} />}
                    <Menu.ItemIndicator><Check size={16} /></Menu.ItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup> : <div className="menu-empty">{t('还没有同步任务')}</div>}
              <Menu.Separator className="menu-separator" />
              <Menu.Item className="task-menu-item" disabled={!canAdd} onSelect={onAdd}>
                <Plus size={16} /><span>{t('添加同步任务')}</span>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>

      <nav className="toolbar-nav" aria-label={t('应用导航')}>
        {sections.map(({ id, icon: Icon, label, shortLabel }) => (
          <button
            key={id}
            className={page === id ? 'current' : ''}
            aria-label={t(label)}
            aria-current={page === id ? 'page' : undefined}
            title={t(label)}
            onClick={() => onPage(id)}
          >
            <Icon size={17} />
            <span>{t(shortLabel)}</span>
            {id === 'devices' && pendingPair && <i className="attention-dot" aria-label={t('有配对请求')} />}
          </button>
        ))}
      </nav>

      <div className="toolbar-actions">
        <span className="toolbar-online" title={t('{n} 台设备在线', { n: onlineCount })}>
          <i className={`connection-dot ${onlineCount > 0 ? 'online' : ''}`} />
          <span>{t('{n} 台在线', { n: onlineCount })}</span>
        </span>
        {actions}
      </div>
    </header>
  );
}
