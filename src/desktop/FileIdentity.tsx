import {fileIdentity,fileKind} from './focus-model';
import {usePrototype} from '../prototype/context';
import {AppIcon,type IconName} from './boardui/icons';
import {Dropdown,DropdownPopover,DropdownTrigger} from './boardui/UI';
const glyphs:Record<string,IconName>={text:'FileText',pdf:'FileText',image:'FileImage',code:'FileCode',folder:'Folder',send:'ArrowUpRight'};
export function FileGlyph({path='',directory=false,send=false}:{path?:string;directory?:boolean;send?:boolean}){
  const kind=send?'send':fileKind(path,directory);
  return <span className={`sf-file-glyph ${kind}`} aria-hidden="true"><AppIcon name={glyphs[kind]} size={20}/></span>;
}
export function FileIdentity({path,directory=false,showPath=true}:{path:string;directory?:boolean;showPath?:boolean}){
  const {t}=usePrototype();const identity=fileIdentity(path);
  return <Dropdown><DropdownTrigger className="sf-file-path-trigger" aria-label={`${identity.name} · ${t('location')}: ${identity.full}`}><span className="sf-file-identity"><FileGlyph path={path} directory={directory}/><span><strong>{identity.name}</strong>{showPath&&<small>{identity.parent||t('rootFolder')}</small>}</span></span></DropdownTrigger><DropdownPopover label={t('location')} placement="bottom start"><div className="sf-full-path" tabIndex={0}>{identity.full}</div></DropdownPopover></Dropdown>;
}
