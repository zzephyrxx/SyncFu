import {useEffect,useState} from 'react';
import type {ScanActivity,ScanProgress} from '../types';
import {usePrototype} from '../prototype/context';
import {AppIcon} from './ui/icons';
import './scan-status.css';

function bytes(value:number){
  if(value<1024)return `${value} B`;
  if(value<1024**2)return `${(value/1024).toFixed(1)} KB`;
  if(value<1024**3)return `${(value/1024**2).toFixed(1)} MB`;
  return `${(value/1024**3).toFixed(2)} GB`;
}
export function ScanStatus({activity,localName,remoteName}:{activity:ScanActivity|null;localName:string;remoteName:string}){
  const {t,number}=usePrototype();const [started]=useState(()=>Date.now());const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[started]);
  const side=(name:string,progress:ScanProgress|null,local:boolean)=>{
    const label=t(progress?.phase==='complete'?'scanComplete':progress?.phase==='hashing'?'scanHashing':progress?'scanDiscovering':'scanWaiting');
    const known=progress?.discovery_complete&&progress.files_total>0;
    return <section className="sf-scan-side" aria-label={name}>
      <div className="sf-scan-side-heading"><strong title={name}>{name}</strong><span>{t(local?'local':'remote')}</span></div>
      <div className="sf-scan-phase"><span>{label}</span>{progress?.phase==='complete'&&<AppIcon name="Check" size={14}/>}</div>
      <progress aria-label={`${name} · ${label}`} max={known?progress.files_total:1} value={progress?.phase==='complete'?1:known?progress.files_hashed:undefined}/>
      <p className="sf-scan-counts">{progress?t(progress.discovery_complete?'scanVerified':'scanBatched',{dirs:number(progress.directories),files:number(progress.files_total),done:number(progress.files_hashed),total:number(progress.files_total),bytes:bytes(progress.bytes_hashed)}):'—'}</p>
      <p className="sf-scan-path" title={progress?.current_path||undefined}>{progress?.current_path||'—'}</p>
    </section>;
  };
  return <section className="sf-scan-status" aria-label={t('scanTitle')}>
    <header><div><AppIcon name="FolderOpen" size={17}/><strong>{t(activity?.incoming?'scanIncoming':'scanTitle')}</strong></div><span>{t('scanElapsed',{seconds:number(elapsed)})}</span></header>
    <div className="sf-scan-sides">{side(localName,activity?.local??null,true)}{!activity?.incoming&&side(remoteName,activity?.remote??null,false)}</div>
    <p className="sf-scan-help">{t('scanWorkingHelp')}</p>
  </section>;
}
