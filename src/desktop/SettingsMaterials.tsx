import {useState} from 'react';
import {usePrototype} from '../prototype/context';
import {FolderArtwork} from './design-system/TaskFolder';
import {Button,Checkbox} from './boardui/UI';
import {AppIcon} from './boardui/icons';

const sources=[
  {name:'BoardUI',license:'MIT',file:new URL('../../assets/boardui-licenses/BoardUI-MIT.txt',import.meta.url).href,zh:'按钮、复选框、选择卡与文件清单',en:'Buttons, checkboxes, selection cards and the file table'},
  {name:'EasyUI',license:'MIT',file:new URL('../../assets/material-licenses/EasyUI-MIT.txt',import.meta.url).href,zh:'侧栏中的彩色任务文件夹与文件夹空状态',en:'Colored task folders in the sidebar and folder empty states'},
  {name:'Morphicons + Lucide',license:'Morphicons · MIT',file:new URL('../../assets/boardui-licenses/Morphicons-MIT.txt',import.meta.url).href,zh:'导航、同步方向、设备状态与操作图标',en:'Navigation, sync direction, device status and action icons'},
  {name:'Inter',license:'OFL-1.1',file:new URL('../../assets/boardui-licenses/Inter-OFL.txt',import.meta.url).href,zh:'界面西文字体；中文使用系统字体',en:'Interface typography, paired with the system CJK font'},
];
export function SettingsMaterials(){
  const {prefs,t}=usePrototype();const [checked,setChecked]=useState(true);const zh=prefs.locale.startsWith('zh');
  return <><h2>{t('materials')}</h2><p className="ui-body-copy">{zh?'这里展示的是当前界面正在使用的组件。':'These are the components used in the current interface.'}</p>
    <div className="sf-materials">{sources.map((source,index)=><section className="sf-material-row" key={source.name} aria-label={source.name}>
      <div>{index===0?<><Checkbox label={zh?'试用复选框':'Try checkbox'} checked={checked} onChange={()=>setChecked(!checked)}/><Button size="small" onClick={()=>setChecked(!checked)}>{zh?'试用':'Try'}</Button></>:index===1?<>{[0,1,2].map(tone=><span className="sf-task-folder" key={tone}><FolderArtwork tone={tone}/></span>)}</>:index===2?<><AppIcon name="Laptop" size={22}/><AppIcon name="ArrowLeftRight" size={20}/><AppIcon name="Monitor" size={22}/></>:<span style={{fontSize:27,fontWeight:550}}>Aa 12</span>}</div>
      <div><strong>{source.name}</strong><p>{zh?source.zh:source.en}</p><a href={source.file} download>{source.license} · {zh?'许可证':'License'}</a>{index===2&&<> · <a href={new URL('../../assets/boardui-licenses/Lucide-ISC.txt',import.meta.url).href} download>Lucide · ISC</a></>}</div>
    </section>)}</div>
  </>;
}
