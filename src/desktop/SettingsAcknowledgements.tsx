import {usePrototype} from '../prototype/context';
import './settings-information.css';

const acknowledgementSources=[
  {name:'shadcn/ui',license:'MIT',url:'https://github.com/shadcn-ui/ui',file:new URL('../../assets/licenses/shadcn-MIT.txt',import.meta.url).href,zh:'按钮、表单、复选框、弹窗、菜单与表格',en:'Buttons, forms, checkboxes, dialogs, menus and tables'},
  {name:'Radix UI',license:'MIT',url:'https://www.radix-ui.com/primitives',file:new URL('../../assets/licenses/Radix-MIT.txt',import.meta.url).href,zh:'键盘导航、三态选择、弹窗焦点与开关交互',en:'Keyboard navigation, tri-state selection, dialog focus and switches'},
  {name:'Lucide',license:'ISC',url:'https://lucide.dev',file:new URL('../../assets/licenses/Lucide-ISC.txt',import.meta.url).href,zh:'统一的导航、设备与文件操作图标',en:'Consistent navigation, device and file action icons'},
  {name:'tauri-ui',license:'MIT',url:'https://github.com/agmmnn/tauri-ui',file:new URL('../../assets/licenses/tauri-ui-NOTICE.md',import.meta.url).href,zh:'Tauri、Vite 与 shadcn 的桌面布局参考',en:'Desktop composition reference for Tauri, Vite and shadcn'},
  {name:'Microsoft Fluent Emoji',license:'MIT',url:'https://github.com/microsoft/fluentui-emoji',file:new URL('../../assets/fluent-emoji/LICENSE.txt',import.meta.url).href,zh:'设备头像与可选择的 emoji 头像',en:'Device avatars and selectable emoji portraits'},
  {name:'Phosphor Icons',license:'MIT',url:'https://phosphoricons.com/',file:new URL('../../assets/licenses/Phosphor-MIT.txt',import.meta.url).href,zh:'在线、离线、同步中等任务状态圆点',en:'Online, offline and syncing status indicators'},
  {name:'react-file-icon',license:'MIT',url:'https://github.com/corygibbons/react-file-icon',file:new URL('../../assets/licenses/react-file-icon-MIT.txt',import.meta.url).href,zh:'按文件类型显示 PDF、文档与代码图标',en:'File-type icons for PDFs, documents and code'},
  {name:'Inter',license:'OFL-1.1',url:'https://rsms.me/inter/',file:new URL('../../assets/licenses/Inter-OFL.txt',import.meta.url).href,zh:'界面西文字体；中文使用系统字体',en:'Interface typography, paired with the system CJK font'},
];
const historicalSources=[
  {name:'EasyUI',license:'MIT',file:new URL('../../assets/licenses/legacy/EasyUI-MIT.txt',import.meta.url).href},
  {name:'BoardUI',license:'MIT',file:new URL('../../assets/licenses/legacy/BoardUI-MIT.txt',import.meta.url).href},
  {name:'Morphicons',license:'MIT',file:new URL('../../assets/licenses/legacy/Morphicons-MIT.txt',import.meta.url).href},
];

export function SettingsAcknowledgements(){
  const {prefs,t}=usePrototype();
  const zh=prefs.locale.startsWith('zh');
  return <section className="sf-acknowledgements" aria-labelledby="sf-acknowledgements-title">
    <h2 id="sf-acknowledgements-title">{t('acknowledgements')}</h2>
    <p className="sf-acknowledgements-intro">{t('acknowledgementsHelp')}</p>
    <ul className="sf-acknowledgements-list">{acknowledgementSources.map(source=><li key={source.name}>
      <div className="sf-acknowledgement-heading"><a href={source.url} target="_blank" rel="noreferrer">{source.name}</a><a className="sf-license-badge" href={source.file} download aria-label={`${source.name} · ${t('licenseLabel')} · ${source.license}`}>{source.license}</a></div>
      <p>{zh?source.zh:source.en}</p>
    </li>)}</ul>
    <section className="sf-acknowledgements-history" aria-labelledby="sf-acknowledgements-history-title">
      <h3 id="sf-acknowledgements-history-title">{t('legacyAcknowledgements')}</h3>
      <p>{t('legacyAcknowledgementsHelp')}</p>
      <ul>{historicalSources.map(source=><li key={source.name}><span>{source.name}</span><a href={source.file} download aria-label={`${source.name} · ${t('licenseLabel')} · ${source.license}`}>{source.license}</a></li>)}</ul>
    </section>
  </section>;
}
