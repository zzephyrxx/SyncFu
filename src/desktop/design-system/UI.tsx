"use client";
// Dialog anatomy adapted from shadcn/ui Sheet (MIT, shadcn 2023).
// Panel composition: Solid Glass (MIT, DeepLethe 2026).
// Press/nav feedback and liquid contour: EasyUI (MIT, Suraj Maurya 2026).
// Adaptations, hashes and license files are recorded in docs/material-redesign/sources.json.
import {forwardRef,useEffect,useState,type ReactNode,type ComponentProps} from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import * as Check from '@radix-ui/react-checkbox';
import {motion,useMotionValue,useSpring,useTransform,type HTMLMotionProps} from 'motion/react';
import {AlertCircle,Check as CheckIcon,LoaderCircle,Minus,X,Laptop,Monitor,ShieldCheck} from 'lucide-react';
import {clsx,type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
import {usePrototype} from '../../prototype/context';
import {motionTokens,springs,useMotionAllowed} from '../../prototype/motion';
import {buildBlobPath} from './blob';
import {FolderArtwork} from './TaskFolder';
export const cn=(...values:ClassValue[])=>twMerge(clsx(values));

export const Button=forwardRef<HTMLButtonElement,HTMLMotionProps<'button'>>(({className,children,...props},ref)=>{
  const allowed=useMotionAllowed();
  return <motion.button type="button" {...props} ref={ref} data-slot="button" className={cn('ui-button',className)} whileTap={allowed&&!props.disabled?{scale:motionTokens.scale.subtle}:undefined} transition={springs.snappy}>{children}</motion.button>;
});
Button.displayName='MaterialButton';
export function NavItem({active,group,children,className,...props}:ComponentProps<'button'>&{active:boolean;group:string}){
  const allowed=useMotionAllowed();
  return <button type="button" {...props} className={cn('ui-nav-item',className)} aria-current={active?'page':undefined} data-active={active}>
    {active&&<motion.i className="ui-nav-highlight" layoutId={allowed?`nav-${group}`:undefined} initial={false} transition={springs.snappy} aria-hidden="true"/>}<span>{children}</span>
  </button>;
}
export function Panel({title,bar,actions,children,className,...props}:Omit<ComponentProps<'section'>,'title'>&{title:string;bar?:ReactNode;actions?:ReactNode}){
  return <section {...props} data-slot="panel" aria-label={title} className={cn('ui-panel flex min-h-0 flex-col overflow-hidden',className)}><header data-slot="panel-header">{bar??<h2>{title}</h2>}{actions}</header>{children}</section>;
}
export function Dialog({title,description,children,onClose,error,className}:{title:string;description?:string;children:ReactNode;onClose:()=>void;error?:string;className?:string}){
  const {t}=usePrototype();const [opener]=useState(()=>typeof document!=='undefined'&&document.activeElement instanceof HTMLElement?document.activeElement:null);
  return <Primitive.Root open onOpenChange={open=>{if(!open)onClose();}}><Primitive.Portal>
    <Primitive.Overlay data-slot="sheet-overlay" className="ui-overlay"/>
    <Primitive.Content data-slot="sheet-content" className={cn('ui-dialog',className)} {...(!description&&{'aria-describedby':undefined})} onInteractOutside={e=>e.preventDefault()} onCloseAutoFocus={event=>{if(opener?.isConnected){event.preventDefault();opener.focus();}}}>
      <header className="ui-dialog-header"><div><Primitive.Title>{title}</Primitive.Title>{description&&<Primitive.Description>{description}</Primitive.Description>}</div><Primitive.Close className="ui-icon-button" aria-label={t('close')}><X size={19}/></Primitive.Close></header>
      <div className="ui-dialog-body">{error&&<Notice tone="error">{error}</Notice>}{children}</div>
    </Primitive.Content>
  </Primitive.Portal></Primitive.Root>;
}
export function Checkbox({checked,mixed=false,disabled,onChange,label}:{checked:boolean;mixed?:boolean;disabled?:boolean;onChange:()=>void;label:string}){
  return <Check.Root data-slot="checkbox" className="ui-checkbox" checked={mixed?'indeterminate':checked} disabled={disabled} onCheckedChange={onChange} aria-label={label}><Check.Indicator>{mixed?<Minus size={13}/>:<CheckIcon size={13}/>}</Check.Indicator></Check.Root>;
}
export function Toggle({checked,disabled,onChange,label}:{checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void;label:string}){
  const allowed=useMotionAllowed();const target=useMotionValue(checked?1:0);const progress=useSpring(target,springs.snappy);
  useEffect(()=>{if(allowed)target.set(checked?1:0);else{target.jump(checked?1:0);progress.jump(checked?1:0);}},[checked,allowed,target,progress]);
  const path=useTransform(progress,p=>buildBlobPath(48,28,p,Math.sin(Math.PI*Math.max(0,Math.min(1,p)))*.5));
  return <button type="button" role="switch" data-slot="switch" className="ui-toggle" aria-label={label} aria-checked={checked} data-state={checked?'checked':'unchecked'} disabled={disabled} onClick={()=>onChange(!checked)}><svg viewBox="0 0 48 28" aria-hidden="true"><motion.path d={allowed?path:buildBlobPath(48,28,checked?1:0,0)}/></svg></button>;
}
export function Spinner(){const allowed=useMotionAllowed();return <motion.span className="ui-spinner" aria-hidden="true" animate={allowed?{rotate:360}:{rotate:0}} transition={allowed?{duration:motionTokens.duration.crawl,repeat:Infinity,ease:'linear'}:{duration:0}}><LoaderCircle size={16}/></motion.span>;}
export function Notice({children,tone='info'}:{children:ReactNode;tone?:'info'|'error'|'success'|'warning'}){
  const Icon=tone==='success'?CheckIcon:AlertCircle;
  return <div className={`ui-notice ${tone}`} role={tone==='error'?'alert':undefined}><Icon size={17} aria-hidden="true"/><div>{children}</div></div>;
}
export function Help({children}:{children:ReactNode}){const {prefs}=usePrototype();return prefs.beginner?<p className="ui-help">{children}</p>:null;}
export function Art({kind,size='normal'}:{kind:'folder'|'laptop'|'desktop'|'shield';size?:'small'|'normal'|'large'}){
  const {prefs}=usePrototype();
  if(kind==='folder')return <span className={`ui-art ${size}`} aria-hidden="true"><FolderArtwork/></span>;
  const Icon=kind==='laptop'?Laptop:kind==='desktop'?Monitor:ShieldCheck;
  if(!prefs.illustrations)return <span className={`ui-art ${size}`} aria-hidden="true"><Icon size={40} strokeWidth={1.2}/></span>;
  return <span className={`ui-art ${size}`} aria-hidden="true"><span className="ui-device-glyph"><Icon strokeWidth={1.15}/><i/></span></span>;
}
export function SuccessMark(){return <span className="ui-success-mark"><CheckIcon size={28}/></span>;}
