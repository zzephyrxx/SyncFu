import {useState} from 'react';
import {usePrototype} from '../prototype/context';
import {Button,Checkbox,Toggle} from './boardui/UI';
import {AppIcon} from './boardui/icons';
import {FluentEmoji} from './FluentEmoji';
import {StatusDot} from './TaskIcon';
import {FileGlyph} from './FileIdentity';

export const materialSources=[
  {name:'shadcn/ui',license:'MIT',url:'https://github.com/shadcn-ui/ui',file:new URL('../../assets/shadcn-licenses/shadcn-MIT.txt',import.meta.url).href,zh:'按钮、表单、复选框、弹窗、菜单与表格',en:'Buttons, forms, checkboxes, dialogs, menus and tables'},
  {name:'Radix UI',license:'MIT',url:'https://www.radix-ui.com/primitives',file:new URL('../../assets/shadcn-licenses/Radix-MIT.txt',import.meta.url).href,zh:'键盘导航、三态选择、弹窗焦点与开关交互',en:'Keyboard navigation, tri-state selection, dialog focus and switches'},
  {name:'Lucide',license:'ISC',url:'https://lucide.dev',file:new URL('../../assets/boardui-licenses/Lucide-ISC.txt',import.meta.url).href,zh:'统一的导航、设备与文件操作图标',en:'Consistent navigation, device and file action icons'},
  {name:'tauri-ui',license:'MIT',url:'https://github.com/agmmnn/tauri-ui',file:new URL('../../assets/shadcn-licenses/tauri-ui-NOTICE.md',import.meta.url).href,zh:'Tauri、Vite 与 shadcn 的桌面布局参考',en:'Desktop composition reference for Tauri, Vite and shadcn'},
  {name:'Microsoft Fluent Emoji',license:'MIT',url:'https://github.com/microsoft/fluentui-emoji',file:new URL('../../assets/fluent-emoji/LICENSE.txt',import.meta.url).href,zh:'设备头像与可选择的 emoji 头像',en:'Device avatars and selectable emoji portraits'},
  {name:'Phosphor Icons',license:'MIT',url:'https://phosphoricons.com/',file:new URL('../../assets/shadcn-licenses/Phosphor-MIT.txt',import.meta.url).href,zh:'在线、离线、同步中等任务状态圆点',en:'Online, offline and syncing status indicators'},
  {name:'react-file-icon',license:'MIT',url:'https://github.com/corygibbons/react-file-icon',file:new URL('../../assets/shadcn-licenses/react-file-icon-MIT.txt',import.meta.url).href,zh:'按文件类型显示 PDF、文档与代码图标',en:'File-type icons for PDFs, documents and code'},
  {name:'Inter',license:'OFL-1.1',url:'https://rsms.me/inter/',file:new URL('../../assets/boardui-licenses/Inter-OFL.txt',import.meta.url).href,zh:'界面西文字体；中文使用系统字体',en:'Interface typography, paired with the system CJK font'},
];
export function SettingsMaterials(){
  const {prefs,t}=usePrototype();const [checked,setChecked]=useState(true);const zh=prefs.locale.startsWith('zh');
  return <><h2>{t('materials')}</h2><p className="ui-body-copy">{zh?'当前界面采用 shadcn/ui 组件与统一的 Lucide 图标。':'The interface uses shadcn/ui components and a consistent Lucide icon set.'}</p>
    <div className="sf-materials">{materialSources.map((source,index)=><section className="sf-material-row" key={source.name} aria-label={source.name}>
      <div>{index===0?<><Checkbox label={zh?'试用复选框':'Try checkbox'} checked={checked} onChange={()=>setChecked(!checked)}/><Button size="small" onClick={()=>setChecked(!checked)}>{zh?'试用':'Try'}</Button></>:index===1?<Toggle checked={checked} onChange={setChecked} label={zh?'试用开关':'Try switch'}/>:index===2?<><AppIcon name="Laptop" size={21}/><AppIcon name="ArrowLeftRight" size={18}/><AppIcon name="Monitor" size={21}/></>:index===3?<><AppIcon name="PanelLeftClose" size={22}/><AppIcon name="LayoutDashboard" size={22}/></>:index===4?<span style={{display:'inline-flex',gap:10,fontSize:30}}><FluentEmoji emoji="🐱"/><FluentEmoji emoji="🐼"/><FluentEmoji emoji="🚀"/></span>:index===5?<><StatusDot status="online" size={15}/><StatusDot status="offline" size={15}/><StatusDot status="syncing" size={15}/></>:index===6?<span className="sf-file-identity"><FileGlyph path="report.pdf"/><FileGlyph path="notes.docx"/><FileGlyph path="app.ts"/></span>:<span style={{fontSize:27,fontWeight:550}}>Aa 12</span>}</div>
      <div><strong>{source.name}</strong><p>{zh?source.zh:source.en}</p><a href={source.file} download>{source.license} · {zh?'许可证':'License'}</a><span aria-hidden="true"> · </span><a href={source.url} target="_blank" rel="noreferrer">{zh?'项目来源':'Source'}</a></div>
    </section>)}</div>
  </>;
}
