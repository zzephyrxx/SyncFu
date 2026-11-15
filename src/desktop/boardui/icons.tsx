"use client";
// Morphicons renders all desktop action icons. Lucide IconNode data is ISC licensed.
// Do not route the user's logo through this renderer.
import {memo,type SVGProps} from 'react';
import {MorphIcon} from 'morphicons/react';
import {ArrowDown,ArrowDownUp,ArrowUp,ArrowDownLeft,ArrowDownToLine,ArrowLeft,ArrowLeftRight,ArrowRight,ArrowUpFromLine,ArrowUpRight,BarChart3,Bell,Check,CheckCircle2,ChevronDown,ChevronLeft,ChevronRight,Clock3,Copy,ExternalLink,File,FileCode,FileImage,FileText,Folder,FolderOpen,Globe2,Grid2X2,History,Info,Laptop,Link,LoaderCircle,Menu,Minus,Monitor,Moon,MoreHorizontal,Palette,PanelLeftClose,PanelLeftOpen,Pause,Play,Plus,RefreshCw,RotateCcw,Search,Settings2,ShieldAlert,ShieldCheck,SlidersHorizontal,Sun,Table2,Trash2,Unplug,Wifi,WifiOff,X} from 'lucide';
import {useMotionAllowed} from '../../prototype/motion';
const icons={ArrowDown,ArrowDownUp,ArrowUp,ArrowDownLeft,ArrowDownToLine,ArrowLeft,ArrowLeftRight,ArrowRight,ArrowUpFromLine,ArrowUpRight,BarChart3,Bell,Check,CheckCircle2,ChevronDown,ChevronLeft,ChevronRight,Clock3,Copy,ExternalLink,File,FileCode,FileImage,FileText,Folder,FolderOpen,Globe2,Grid2X2,History,Info,Laptop,Link,LoaderCircle,Menu,Minus,Monitor,Moon,MoreHorizontal,Palette,PanelLeftClose,PanelLeftOpen,Pause,Play,Plus,RefreshCw,RotateCcw,Search,Settings2,ShieldAlert,ShieldCheck,SlidersHorizontal,Sun,Table2,Trash2,Unplug,Wifi,WifiOff,X};
export type IconName=keyof typeof icons;
export interface AppIconProps extends Omit<SVGProps<SVGSVGElement>,'from'|'to'|'ref'>{name:IconName;size?:number;label?:string}
export const AppIcon=memo(function AppIcon({name,size=18,label,strokeWidth=1.7,...props}:AppIconProps){const animate=useMotionAllowed();return <MorphIcon {...props} icon={icons[name]} size={size} strokeWidth={strokeWidth} label={label} reducedMotion={animate?'user':'always'}/>;});
type Props=Omit<AppIconProps,'name'>;
const make=(name:IconName)=>function Icon(props:Props){return <AppIcon {...props} name={name}/>;};
export const ArrowDownLeftIcon=make('ArrowDownLeft');
export const CheckIcon=make('Check');
export const CloseIcon=make('X');
export const Glyph=Object.fromEntries(Object.keys(icons).map(name=>[name,make(name as IconName)])) as Record<IconName,(props:Props)=>React.ReactElement>;
