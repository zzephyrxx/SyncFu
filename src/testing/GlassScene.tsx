import {useState} from 'react';
import {command} from '../api';
import {PrototypeProvider,usePrototype} from '../prototype/context';
import {GlassProvider,useGlassSnapshotAvailable} from '../desktop/glass/Glass';
import {Dialog,Button,Dropdown,DropdownTrigger,DropdownPopover,DropdownItem} from '../desktop/ui/UI';
import {AppSelect} from '../components/ui/select';
import '../desktop/ui/index.css';
import '../components/ui/tokens.css';
import '../components/ui/primitives.css';
import '../desktop/workspace.css';
import '../desktop/glass.css';
import '../desktop/glass-controls.css';
import './glass-scene.css';
function CaptureStatus(){const active=useGlassSnapshotAvailable();return <p role="status">{active?'原生取景已就绪 · 边缘像素折射':'未取得快照 · 实时透明回退'}</p>;}
function Scene(){const {prefs,setPref}=usePrototype();const [open,setOpen]=useState(false);const [value,setValue]=useState('one');const [diagnostic,setDiagnostic]=useState('');const testCapture=async()=>{const start=performance.now();try{const image=await command<{width:number;height:number;capture_ms?:number;encode_ms?:number}>('capture_glass_backdrop');setDiagnostic(`快照成功 ${image.width}×${image.height} · ${Math.round(performance.now()-start)}ms · native ${image.capture_ms}ms / encode ${image.encode_ms}ms`);}catch(error){setDiagnostic(String(error));}};return <div className="board-app glass-qa-scene">
  <div className="glass-qa-grid" aria-hidden="true"/>
  <header><h1>玻璃光学检查</h1><a href="/?desktop-test&scenario=overview">应用界面</a><Button onClick={()=>setPref('material',prefs.material==='glass'?'solid':'glass')}>{prefs.material==='glass'?'切换实色':'启用玻璃'}</Button><Button onClick={()=>setPref('theme',prefs.theme==='dark'?'light':'dark')}>切换深浅色</Button><Button onClick={()=>setOpen(true)}>打开测试弹窗</Button><Button onClick={()=>void testCapture()}>检查原生取景</Button></header><p style={{position:"relative",zIndex:1}} role="status">{diagnostic}</p>
  <div className="glass-qa-markers" aria-hidden="true"><i/><i/><i/><strong>LOCAL · 0123456789</strong></div>
  <aside><AppSelect aria-label="场景菜单" value={value} onValueChange={setValue} options={[{value:'one',label:'清晰的文字与图标'},{value:'two',label:'透明的中心区域'},{value:'three',label:'向内弯折的边缘'}]}/></aside>
  {open&&<Dialog title="独立背景折射层" description="观察玻璃边缘附近的网格线弯折，中心文字保持清晰。" onClose={()=>setOpen(false)}><CaptureStatus/><p>快照只用于窄边缘，中心保持实时背景。窗口缩放时丢弃旧取景。</p><div className="glass-qa-fields"><AppSelect aria-label="弹窗菜单" value={value} onValueChange={setValue} options={[{value:'one',label:'清晰的文字与图标'},{value:'two',label:'透明的中心区域'},{value:'three',label:'向内弯折的边缘'}]}/><Dropdown><DropdownTrigger>更多菜单</DropdownTrigger><DropdownPopover label="测试菜单"><CaptureStatus/><DropdownItem onSelect={()=>{}}>普通菜单项</DropdownItem><DropdownItem onSelect={()=>{}}>另一项操作</DropdownItem>{Array.from({length:40},(_,i)=><DropdownItem key={i} onSelect={()=>{}}>长菜单项目 {i+1}</DropdownItem>)}</DropdownPopover></Dropdown></div><div className="ui-modal-actions"><Button onClick={()=>setOpen(false)}>关闭测试</Button></div></Dialog>}
</div>;}
export default function GlassScene(){return <PrototypeProvider mode="desktop"><GlassProvider><Scene/></GlassProvider></PrototypeProvider>;}
