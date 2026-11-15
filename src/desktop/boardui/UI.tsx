// Compatibility facade for the production views. All interactive primitives are
// now local shadcn/ui components backed by Radix, not the previous BoardUI kit.
import {createContext,useContext,useState,type ComponentProps,type ComponentType,type ReactElement,type ReactNode} from 'react';
import {Button as ShadcnButton} from '../../components/ui/button';
import {Checkbox as ShadcnCheckbox} from '../../components/ui/checkbox';
import {Switch} from '../../components/ui/switch';
import {Dialog as ShadcnDialog,DialogContent,DialogTitle,DialogDescription} from '../../components/ui/dialog';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuCheckboxItem} from '../../components/ui/dropdown-menu';
import {Popover,PopoverTrigger,PopoverContent} from '../../components/ui/popover';
import {Tooltip,TooltipTrigger,TooltipContent} from '../../components/ui/tooltip';
import {cn as cx} from '../../components/ui/utils';
import {AppIcon} from './icons';
import {usePrototype} from '../../prototype/context';
import {motion} from 'motion/react';
import {motionTokens,useMotionAllowed} from '../../prototype/motion';
export {CheckboxCard} from '../../components/ui/selection';
export {cx};

type ButtonIcon=ComponentType<{className?:string;'aria-hidden'?:boolean|'true'|'false'}>;
export interface ButtonProps extends Omit<ComponentProps<'button'>,'children'> {
  variant?:'primary'|'secondary'|'ghost'|'danger';size?:'medium'|'small'|'xs';
  iconOnly?:boolean;leadingIcon?:ButtonIcon;trailingIcon?:ButtonIcon;children?:ReactNode;
}
export function Button({className,variant,size='medium',leadingIcon:Leading,trailingIcon:Trailing,children,iconOnly=false,type='button',...props}:ButtonProps){
  const style=variant??(className?.split(' ').includes('primary')?'primary':'secondary');
  return <ShadcnButton {...props} type={type} variant={style==='primary'?'default':style==='danger'?'destructive':style==='ghost'?'ghost':'outline'} size={iconOnly?(size==='small'?'icon-sm':size==='xs'?'icon-xs':'icon'):(size==='small'?'sm':size==='xs'?'xs':'default')} className={cx('bui-button sfu-button',className)}>
    {Leading&&<Leading className="size-4" aria-hidden/>}{children!==undefined&&<span className="sfu-button-label">{children}</span>}{Trailing&&<Trailing className="size-4" aria-hidden/>}
  </ShadcnButton>;
}
export function Tip({label,children}:{label:string;children:ReactElement}){return <Tooltip delayDuration={300}><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent sideOffset={6} className="bui-tooltip sfu-tooltip">{label}</TooltipContent></Tooltip>;}
export function IconButton({label,children,...props}:Omit<ButtonProps,'children'>&{label:string;children:ReactNode}){return <Tip label={label}><Button {...props} iconOnly aria-label={label} className={cx('bui-icon-button',props.className)}>{children}</Button></Tip>;}
export function Checkbox({checked,mixed=false,disabled,onChange,label}:{checked:boolean;mixed?:boolean;disabled?:boolean;onChange:()=>void;label:string}){return <ShadcnCheckbox aria-label={label} checked={mixed?'indeterminate':checked} disabled={disabled} onCheckedChange={onChange} className="sfu-checkbox bui-checkbox-hit"/>;}
export function Toggle({checked,disabled,onChange,label}:{checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void;label:string}){return <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} className="sfu-switch bui-switch"/>;}
export function Spinner(){const animate=useMotionAllowed();return <motion.span className="bui-spinner" aria-hidden="true" animate={animate?{rotate:360}:{rotate:0}} transition={animate?{duration:motionTokens.duration.crawl,repeat:Infinity,ease:'linear'}:{duration:0}}><AppIcon name="LoaderCircle" size={17}/></motion.span>;}
export function Notice({children,tone='info'}:{children:ReactNode;tone?:'info'|'error'|'success'|'warning'}){return <div className={`bui-notice ${tone}`} role={tone==='error'?'alert':undefined}><AppIcon name={tone==='success'?'CheckCircle2':tone==='error'?'ShieldAlert':'Info'} size={17}/><div>{children}</div></div>;}
export function Help({children}:{children:ReactNode}){const {prefs}=usePrototype();return prefs.beginner?<p className="ui-help">{children}</p>:null;}
export function Art({kind,size='normal'}:{kind:'folder'|'laptop'|'desktop'|'shield';size?:'small'|'normal'|'large'}){return <span className={`bui-art sfu-empty-icon ${size}`} aria-hidden="true"><AppIcon name={kind==='folder'?'Folder':kind==='laptop'?'Laptop':kind==='desktop'?'Monitor':'ShieldCheck'} size={size==='large'?38:size==='small'?22:30} strokeWidth={1.5}/></span>;}
export function SuccessMark(){return <span className="bui-success-mark"><AppIcon name="CheckCircle2" size={32}/></span>;}
export function Dialog({title,description,children,onClose,error,className,dismissDisabled=false}:{title:string;description?:string;children:ReactNode;onClose:()=>void;error?:string;className?:string;dismissDisabled?:boolean}){
  const {t}=usePrototype();const [opener]=useState(()=>document.activeElement instanceof HTMLElement?document.activeElement:null);
  const close=()=>{if(!dismissDisabled)onClose();};
  return <ShadcnDialog open onOpenChange={open=>{if(!open)close();}}><DialogContent showCloseButton={false} overlayClassName="bui-overlay sfu-dialog-overlay" className={cx('bui-modal sfu-dialog-content p-0 gap-0',className)} {...(!description&&{'aria-describedby':undefined})} onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(dismissDisabled)event.preventDefault();}} onCloseAutoFocus={event=>{event.preventDefault();if(opener?.isConnected)opener.focus({preventScroll:true});else document.querySelector<HTMLElement>('.sf-workspace')?.focus({preventScroll:true});}}>
    <div className="bui-dialog"><header><div><DialogTitle>{title}</DialogTitle>{description&&<DialogDescription>{description}</DialogDescription>}</div><Button iconOnly aria-label={t('close')} className="bui-icon-button" variant="ghost" disabled={dismissDisabled} onClick={close}><AppIcon name="X" size={18}/></Button></header><div className="bui-dialog-body">{error&&<Notice tone="error">{error}</Notice>}{children}</div></div>
  </DialogContent></ShadcnDialog>;
}
type DropdownKind='menu'|'popover';
const MenuContext=createContext<{close:()=>void;kind:DropdownKind}>({close:()=>{},kind:'menu'});
export function Dropdown({children,isOpen,onOpenChange,kind='menu'}:{children:ReactNode;isOpen?:boolean;onOpenChange?:(open:boolean)=>void;kind?:DropdownKind}){
  const [local,setLocal]=useState(false);const set=(value:boolean)=>{setLocal(value);onOpenChange?.(value);};
  const Root=kind==='menu'?DropdownMenu:Popover;
  return <MenuContext.Provider value={{close:()=>set(false),kind}}><Root open={isOpen??local} onOpenChange={set}>{children}</Root></MenuContext.Provider>;
}
export function DropdownTrigger({className,...props}:ComponentProps<'button'>){const {kind}=useContext(MenuContext);const Trigger=kind==='menu'?DropdownMenuTrigger:PopoverTrigger;return <Trigger type="button" {...props} className={cx('bui-dropdown-trigger',className)}/>;}
type Placement='bottom end'|'bottom start'|'top end'|'top start';
export function DropdownPopover({children,label,className,placement='bottom end'}:{children:ReactNode;label:string;className?:string;placement?:Placement}){
  const {kind}=useContext(MenuContext);const side=placement.startsWith('top')?'top':'bottom';const align=placement.endsWith('start')?'start':'end';
  return kind==='menu'?<DropdownMenuContent aria-label={label} side={side} align={align} sideOffset={6} collisionPadding={12} className={cx('bui-popover sfu-menu',className)}>{children}</DropdownMenuContent>:<PopoverContent aria-label={label} side={side} align={align} sideOffset={6} collisionPadding={12} className={cx('bui-popover sfu-popover',className)}>{children}</PopoverContent>;
}
export function DropdownItem({children,onSelect,disabled=false}:{children:ReactNode;onSelect:()=>void;disabled?:boolean}){
  const {kind,close}=useContext(MenuContext);
  return kind==='menu'?<DropdownMenuItem disabled={disabled} className="bui-menu-item" onSelect={onSelect}>{children}</DropdownMenuItem>:<Button variant="ghost" disabled={disabled} className="bui-menu-item" onClick={()=>{close();onSelect();}}>{children}</Button>;
}
export function DropdownCheckboxItem({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean}){return <DropdownMenuCheckboxItem checked={checked} disabled={disabled} className="sfu-menu-check" onCheckedChange={onChange} onSelect={event=>event.preventDefault()}>{label}</DropdownMenuCheckboxItem>;}
export function Panel({title,actions,children,className}:{title:string;actions?:ReactNode;children:ReactNode;className?:string}){return <section className={cx('bui-panel',className)} aria-label={title}><header><h2>{title}</h2>{actions}</header>{children}</section>;}
export function NavItem({active,group:_group,children,className,...props}:ComponentProps<'button'>&{active:boolean;group?:string}){return <button type="button" {...props} className={cx('bui-nav-item',className)} aria-current={active?'page':undefined} data-active={active}>{children}</button>;}
