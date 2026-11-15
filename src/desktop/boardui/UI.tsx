"use client";
// BoardUI's DialogTrigger/Popover and tooltip composition, adapted for a fixed
// desktop shell (no Next routing or demo scroll-lock workaround required).
import {createContext,useContext,useState,type ComponentProps,type ReactNode} from 'react';
import {Button as AriaButton,Dialog as AriaDialog,DialogTrigger,Focusable,Heading,Modal,ModalOverlay,Popover,Switch,Tooltip as AriaTooltip,TooltipTrigger} from 'react-aria-components';
import {Button as BoardButton,type ButtonProps} from './vendor/button';
import {Checkbox as BoardCheckbox} from './vendor/checkbox';
import {cx} from './cx';
import {AppIcon} from './icons';
import {usePrototype} from '../../prototype/context';
import {motion} from 'motion/react';
import {motionTokens,useMotionAllowed} from '../../prototype/motion';
import {FolderArtwork} from '../design-system/TaskFolder';
export {CheckboxCard} from './vendor/checkbox-card';
export {cx};
export function Button({className,variant,...props}:ButtonProps){return <BoardButton {...props} variant={variant??(className?.split(' ').includes('primary')?'primary':'secondary')} className={cx('bui-button',className)}/>;}
export function Tip({label,children}:{label:string;children:ComponentProps<typeof Focusable>['children']}){return <TooltipTrigger delay={250} closeDelay={0}><Focusable>{children}</Focusable><AriaTooltip className="bui-tooltip" offset={7}>{label}</AriaTooltip></TooltipTrigger>;}
export function IconButton({label,children,...props}:Omit<ButtonProps,'children'>&{label:string;children:ReactNode}){return <Tip label={label}><Button {...props} aria-label={label} className={cx('bui-icon-button',props.className)}>{children}</Button></Tip>;}
export function Checkbox({checked,mixed=false,disabled,onChange,label}:{checked:boolean;mixed?:boolean;disabled?:boolean;onChange:()=>void;label:string}){return <BoardCheckbox aria-label={label} isSelected={checked} isIndeterminate={mixed} isDisabled={disabled} onChange={()=>onChange()} className="bui-checkbox-hit"/>;}
export function Toggle({checked,disabled,onChange,label}:{checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void;label:string}){return <Switch aria-label={label} isSelected={checked} isDisabled={disabled} onChange={onChange} className="bui-switch"><span className="bui-switch-track"><i/></span></Switch>;}
export function Spinner(){const animate=useMotionAllowed();return <motion.span className="bui-spinner" aria-hidden="true" animate={animate?{rotate:360}:{rotate:0}} transition={animate?{duration:motionTokens.duration.crawl,repeat:Infinity,ease:'linear'}:{duration:0}}><AppIcon name="LoaderCircle" size={17}/></motion.span>;}
export function Notice({children,tone='info'}:{children:ReactNode;tone?:'info'|'error'|'success'|'warning'}){return <div className={`bui-notice ${tone}`} role={tone==='error'?'alert':undefined}><AppIcon name={tone==='success'?'CheckCircle2':tone==='error'?'ShieldAlert':'Info'} size={17}/><div>{children}</div></div>;}
export function Help({children}:{children:ReactNode}){const {prefs}=usePrototype();return prefs.beginner?<p className="ui-help">{children}</p>:null;}
const art={laptop:new URL('../../../assets/prototype/laptop_3d.png',import.meta.url).href,desktop:new URL('../../../assets/prototype/desktop_computer_3d.png',import.meta.url).href,shield:new URL('../../../assets/prototype/shield_3d.png',import.meta.url).href};
export function Art({kind,size='normal'}:{kind:'folder'|keyof typeof art;size?:'small'|'normal'|'large'}){const {prefs}=usePrototype();return <span className={`bui-art ${size}`} aria-hidden="true">{kind==='folder'?<FolderArtwork/>:prefs.illustrations?<img src={art[kind]} alt="" draggable={false}/>:<AppIcon name={kind==='laptop'?'Laptop':kind==='desktop'?'Monitor':'ShieldCheck'} size={size==='large'?64:32}/>}</span>;}
export function SuccessMark(){return <span className="bui-success-mark"><AppIcon name="CheckCircle2" size={32}/></span>;}
export function Dialog({title,description,children,onClose,error,className,dismissDisabled=false}:{title:string;description?:string;children:ReactNode;onClose:()=>void;error?:string;className?:string;dismissDisabled?:boolean}){
  const {t}=usePrototype();const [opener]=useState(()=>document.activeElement instanceof HTMLElement?document.activeElement:null);
  const close=()=>{if(dismissDisabled)return;onClose();requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});else document.querySelector<HTMLElement>('.sf-workspace')?.focus({preventScroll:true});});};
  return <ModalOverlay isOpen isKeyboardDismissDisabled={dismissDisabled} onOpenChange={open=>{if(!open)close();}} className="bui-overlay"><Modal className={cx('bui-modal',className)}><AriaDialog aria-label={title} className="bui-dialog"><header><div><Heading slot="title">{title}</Heading>{description&&<p>{description}</p>}</div><IconButton label={t('close')} variant="ghost" disabled={dismissDisabled} onClick={close}><AppIcon name="X" size={18}/></IconButton></header><div className="bui-dialog-body">{error&&<Notice tone="error">{error}</Notice>}{children}</div></AriaDialog></Modal></ModalOverlay>;
}
const MenuContext=createContext<()=>void>(()=>{});
export function Dropdown({children,isOpen,onOpenChange}:{children:ReactNode;isOpen?:boolean;onOpenChange?:(open:boolean)=>void}){
  const [local,setLocal]=useState(false);const set=(value:boolean)=>{setLocal(value);onOpenChange?.(value);};
  return <MenuContext.Provider value={()=>set(false)}><DialogTrigger isOpen={isOpen??local} onOpenChange={set}>{children}</DialogTrigger></MenuContext.Provider>;
}
export function DropdownTrigger({disabled,className,...props}:Omit<ComponentProps<typeof AriaButton>,'className'>&{disabled?:boolean;className?:string}){return <AriaButton {...props} isDisabled={disabled??props.isDisabled} className={cx('bui-dropdown-trigger',className)}/>;}
export function DropdownPopover({children,label,className,placement='bottom end'}:{children:ReactNode;label:string;className?:string;placement?:ComponentProps<typeof Popover>['placement']}){return <Popover placement={placement} offset={6} className={cx('bui-popover',className)}><AriaDialog aria-label={label}>{children}</AriaDialog></Popover>;}
export function DropdownItem({children,onSelect,disabled=false}:{children:ReactNode;onSelect:()=>void;disabled?:boolean}){const close=useContext(MenuContext);return <AriaButton isDisabled={disabled} className="bui-menu-item" onPress={()=>{close();onSelect();}}>{children}</AriaButton>;}
export function Panel({title,actions,children,className}:{title:string;actions?:ReactNode;children:ReactNode;className?:string}){return <section className={cx('bui-panel',className)} aria-label={title}><header><h2>{title}</h2>{actions}</header>{children}</section>;}
export function NavItem({active,group:_group,children,className,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{active:boolean;group?:string}){return <button type="button" {...props} className={cx('bui-nav-item',className)} aria-current={active?'page':undefined} data-active={active}>{children}</button>;}
