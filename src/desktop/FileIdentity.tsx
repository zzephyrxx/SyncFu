import {fileIdentity,fileKind} from './focus-model';
import {usePrototype} from '../prototype/context';
import {FileIcon,defaultStyles,type FileIconProps} from 'react-file-icon';
import {Send} from 'lucide-react';
import {Dropdown,DropdownPopover,DropdownTrigger} from './boardui/UI';
import {TaskIcon} from './TaskIcon';
import './file-identity.css';
const fallback:FileIconProps={type:'document',color:'#edf0f4',foldColor:'#d9dfe8',glyphColor:'#748196',labelColor:'#748196'};
export function FileGlyph({path='',directory=false,send=false}:{path?:string;directory?:boolean;send?:boolean}){
  const kind=send?'send':fileKind(path,directory);
  const name=fileIdentity(path).name,extension=name.includes('.')&&!name.startsWith('.')?name.split('.').pop()!.toLowerCase():'';
  const styles=Object.hasOwn(defaultStyles,extension)?defaultStyles[extension as keyof typeof defaultStyles]:{...fallback,type:kind==='code'?'code':kind==='image'?'image':'document'} as FileIconProps;
  return <span className={`sf-file-glyph ${kind}`} aria-hidden="true">{send?<Send size={20}/>:directory?<TaskIcon tone={1} size={25}/>:<FileIcon {...styles} extension={extension.slice(0,5)||undefined} gradientOpacity={0} radius={3} labelUppercase/>}</span>;
}
export function FileIdentity({path,directory=false,showPath=true}:{path:string;directory?:boolean;showPath?:boolean}){
  const {t}=usePrototype();const identity=fileIdentity(path);
  return <Dropdown kind="popover"><DropdownTrigger className="sf-file-path-trigger" aria-label={`${identity.name} · ${t('location')}: ${identity.full}`}><span className="sf-file-identity"><FileGlyph path={path} directory={directory}/><span><strong>{identity.name}</strong>{showPath&&<small>{identity.parent||t('rootFolder')}</small>}</span></span></DropdownTrigger><DropdownPopover label={t('location')} placement="bottom start"><div className="sf-full-path" tabIndex={0}>{identity.full}</div></DropdownPopover></Dropdown>;
}
