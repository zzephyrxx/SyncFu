import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Button,Notice,Spinner,Dialog,SuccessMark} from './ui/UI';
import {AppIcon} from './ui/icons';
import {usePrototype} from '../prototype/context';
import {motionTokens,useMotionAllowed} from '../prototype/motion';
import {Reel} from '../ui/DigitReels';
import {PairingCodeInput} from './PairingCodeInput';
import {pairingCopy} from './pairing-copy';
import {useDeviceProfiles} from './useDeviceProfiles';
import {deviceDisplayName} from './device-metadata';
import {DeviceAvatar} from './DeviceAvatar';
import type {DesktopController} from './controller';
import './pairing.css';

export function LivePairing({c,onClose}:{c:DesktopController;onClose:()=>void}){
  const {t,prefs}=usePrototype();const text=(key:Parameters<typeof pairingCopy>[1])=>pairingCopy(prefs.locale,key);
  const {profiles}=useDeviceProfiles();
  const animate=useMotionAllowed();
  const [mode,setMode]=useState<'receive'|'start'>(c.snapshot.pending.length?'receive':'start');
  const [invite,setInvite]=useState<{code:string;expires_at:number}|null>(null);
  const [rolling,setRolling]=useState(false),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
  const [manual,setManual]=useState(false),[address,setAddress]=useState(''),[deviceId,setDeviceId]=useState<string|null>(null);
  const [digits,setDigits]=useState<string[]>(Array(5).fill(''));
  const [approved,setApproved]=useState(''),[sent,setSent]=useState(false),[copied,setCopied]=useState(false),[now,setNow]=useState(Date.now);
  const epoch=useRef(0),alive=useRef(true),mountedInvite=useRef(false);
  const hasPending=useRef(false);hasPending.current=c.snapshot.pending.length>0;
  const selected=c.snapshot.nearby.find(device=>device.id===deviceId);
  const targetAddress=manual?address.trim():selected?.address??'';
  const code=digits.join('');
  const paired=sent||Boolean(approved&&c.snapshot.peers.some(peer=>peer.id===approved));
  const readableError=(value:unknown)=>String(value).replaceAll('动态码','配对码');
  const generate=async()=>{
    const id=++epoch.current;setInvite(null);setCopied(false);setError('');setBusy(true);
    try{const next=await c.transport<{code:string;expires_at:number}>('invite');if(alive.current&&id===epoch.current&&!hasPending.current){setInvite(next);setRolling(animate);setNow(Date.now());}}
    catch(e){if(alive.current&&id===epoch.current)setError(readableError(e));}
    finally{if(alive.current&&id===epoch.current)setBusy(false);}
  };
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(c.snapshot.pending.length){setInvite(null);setRolling(false);mountedInvite.current=false;}},[c.snapshot.pending.length]);
  useEffect(()=>{if(mode==='receive'&&!mountedInvite.current&&!c.snapshot.pending.length&&!approved){mountedInvite.current=true;void generate();}},[mode,c.snapshot.pending.length,approved]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),400);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(!invite||!rolling)return;const timer=setTimeout(()=>setRolling(false),animate?(motionTokens.duration.crawl+4*motionTokens.duration.fast)*1000+40:0);return()=>clearTimeout(timer);},[invite,rolling,animate]);
  useEffect(()=>{if(!approved||paired)return;const timer=setTimeout(()=>{mountedInvite.current=true;setApproved('');setError(text('approvalTimeout'));},18000);return()=>clearTimeout(timer);},[approved,paired]);
  const expiry=Math.max(0,Math.ceil((invite?.expires_at??0)-now/1000));
  const ready=mode==='receive'&&Boolean(invite)&&expiry>0&&!rolling&&!busy&&!approved&&!c.snapshot.pending.length;
  const copy=async()=>{
    if(!ready||!invite||invite.expires_at<=Date.now()/1000)return;
    const generation=epoch.current;
    try{await navigator.clipboard.writeText(invite.code);if(alive.current&&generation===epoch.current&&invite.expires_at>Date.now()/1000)setCopied(true);}
    catch{if(alive.current&&generation===epoch.current)setError(t('clipboardError'));}
  };
  const respond=async(id:string,accept:boolean)=>{
    let answered=false;
    setBusy(true);setError('');if(accept)setApproved(id);
    try{await c.transport('answer_pair',{id,accept});answered=true;if(!alive.current)return;setInvite(null);mountedInvite.current=false;await c.refresh();}
    catch(e){if(alive.current){if(accept&&!answered)setApproved('');setError(readableError(e));}}
    finally{if(alive.current)setBusy(false);}
  };
  const refreshNearby=async()=>{setRefreshing(true);setError('');try{await c.refresh();}catch(e){if(alive.current)setError(readableError(e));}finally{if(alive.current)setRefreshing(false);}};
  const send=async(event:FormEvent)=>{
    event.preventDefault();if(busy||!/^\d{5}$/.test(code)||!targetAddress)return;
    setBusy(true);setError('');
    try{await c.transport('pair',{address:targetAddress,code,deviceId:manual?null:deviceId});if(alive.current){setSent(true);await c.refresh();}}
    catch(e){if(alive.current)setError(readableError(e));}
    finally{if(alive.current)setBusy(false);}
  };
  return <Dialog title={text('title')} description={text('description')} className={`sf-pair-modal ${mode==='start'&&!paired?'sf-pair-wide':''}`} dismissDisabled={Boolean(approved&&!paired)} onClose={onClose}>
    {error&&<Notice tone="error">{error}</Notice>}
    <div className="sf-pairing">
      {!paired&&<div className="sf-pair-tabs" role="group" aria-label={text('title')}>
        {(['start','receive'] as const).map(value=><Button key={value} variant="ghost" disabled={busy||!!approved} aria-pressed={mode===value} onClick={()=>{setMode(value);setError('');setCopied(false);}}><AppIcon name={value==='start'?'Wifi':'Laptop'} size={16}/>{t(value==='receive'?'receivePair':'startPair')}{value==='receive'&&c.snapshot.pending.length>0&&<span className="sf-pair-count">{c.snapshot.pending.length}</span>}</Button>)}
      </div>}
      {paired?<div className="sf-pair-success"><SuccessMark/><h3>{t('paired')}</h3><p>{text('security')}</p><Button variant="primary" onClick={onClose}>{t('done')}</Button></div>:mode==='start'?<form className="sf-pair-start" onSubmit={event=>void send(event)}>
        <div className="sf-pair-discovery-pane"><section className="sf-pair-discovery" aria-labelledby="sf-pair-discovery-title">
          <header><div><h3 id="sf-pair-discovery-title">{text('select')}</h3><p>{text('scan')}</p></div><Button variant="ghost" size="small" disabled={busy||refreshing} aria-label={text('refresh')} onClick={()=>void refreshNearby()}>{refreshing?<Spinner/>:<AppIcon name="RefreshCw" size={16}/>}</Button></header>
          {c.snapshot.nearby.length?<fieldset className="sf-pair-devices" aria-label={text('select')} disabled={busy}>
            {c.snapshot.nearby.map(device=><label key={device.id} className={`sf-pair-device ${!manual&&deviceId===device.id?'is-selected':''}`}>
              <input type="radio" name="nearby-device" value={device.id} checked={!manual&&deviceId===device.id} onChange={()=>{setDeviceId(device.id);setManual(false);setError('');}}/>
              <DeviceAvatar className="sf-pair-device-icon" deviceId={device.id} profiles={profiles}/>
              <span className="sf-pair-device-name"><strong title={device.name}>{deviceDisplayName(device,profiles)}</strong><small>{device.address}</small></span>
              <span className="sf-pair-device-check" aria-hidden="true">{!manual&&deviceId===device.id&&<AppIcon name="Check" size={13}/>}</span>
            </label>)}
          </fieldset>:<div className="sf-pair-discovery-empty" role="status"><AppIcon name="Wifi" size={26}/><strong>{text('empty')}</strong><p>{text('emptyHelp')}</p></div>}
          {deviceId&&!manual&&!selected&&<Notice tone="warning">{text('unavailable')}</Notice>}
        </section>
        <details className="sf-pair-manual" open={manual} onToggle={event=>{if(!busy)setManual(event.currentTarget.open);}}>
          <summary onClick={event=>{event.preventDefault();if(!busy)setManual(value=>!value);}} aria-disabled={busy}><AppIcon name="ChevronRight" size={14}/>{text('manual')}</summary>
          <div><label htmlFor="sf-pair-address">{t('address')}</label><input id="sf-pair-address" value={address} disabled={busy||!manual} onChange={event=>setAddress(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="192.168.1.20:47657" required={manual}/><p>{text('manualHelp')}</p></div>
        </details>
        </div>
        <div className="sf-pair-verification">
          <PairingCodeInput digits={digits} onChange={setDigits} label={t('pairCode')} description={text('codeHelp')} disabled={busy}/>
          {selected&&!manual&&<p className="sf-pair-target"><AppIcon name="Laptop" size={14}/><span>{text('selected')} <strong>{deviceDisplayName(selected,profiles)}</strong></span></p>}
          {manual&&targetAddress&&<p className="sf-pair-target"><AppIcon name="Link" size={14}/><span>{targetAddress}</span></p>}
          <Button className="sf-pair-submit" type="submit" variant="primary" disabled={busy||!/^\d{5}$/.test(code)||!targetAddress}>{busy?<Spinner/>:<AppIcon name="Link" size={15}/>} {t(busy?'pairWaiting':'sendRequest')}</Button>
        </div>
      </form>:<div className="sf-pair-receive">
        <div className="sf-pair-this-device"><DeviceAvatar deviceId={c.snapshot.device.id} profiles={profiles} local/><div><strong title={c.snapshot.device.name}>{deviceDisplayName(c.snapshot.device,profiles)}</strong><p>{text('receiveHelp')}</p></div></div>
        {approved||c.snapshot.pending.length>0?<p className="sf-pair-approval" role="status">{approved&&<Spinner/>}{approved?text('approvalWait'):text('review')}</p>:<>
        <h3 className="ui-code-heading">{t(busy||rolling?'rolling':expiry>0?'codeReady':'codeExpired')}</h3>
        <div className="ui-code-machine" data-phase={rolling?'spinning':ready?'ready':'inactive'}><div className="ui-reels" aria-hidden="true">{Array.from({length:5},(_,index)=><Reel classPrefix="ui" key={`${invite?.code??'none'}-${index}`} digit={Number(invite?.code[index]??0)} index={index} animate={rolling&&animate} expired={!invite||expiry===0||!!approved||Boolean(c.snapshot.pending.length)}/>)}</div></div>
        <span className="ui-code-announcement" aria-live="polite">{ready&&invite?`${t('pairCode')} ${[...invite.code].join(' ')}`:''}</span>
        <div className="ui-code-tools"><Button size="small" disabled={busy||rolling||!!approved||Boolean(c.snapshot.pending.length)} onClick={()=>void generate()}><AppIcon name="RefreshCw" size={15}/>{t('refreshCode')}</Button><Button size="small" disabled={!ready} onClick={()=>void copy()}><AppIcon name={copied?'Check':'Copy'} size={15}/>{t(copied?'copied':'copyCode')}</Button></div>
        <p className="ui-code-timer">{expiry>0?t('expiresIn',{n:expiry}):t('codeExpired')}</p></>}
        {c.snapshot.pending.map(peer=><div className="sf-pair-request" key={peer.id}><div><strong title={peer.name}>{deviceDisplayName(peer,profiles)}</strong><p>{text('request')}</p></div><Button size="small" disabled={busy} onClick={()=>void respond(peer.id,false)}>{t('reject')}</Button><Button size="small" variant="primary" disabled={busy} onClick={()=>void respond(peer.id,true)}>{t('pairApprove')}</Button></div>)}
        {!!c.snapshot.device.addresses?.length&&<details className="sf-pair-addresses"><summary>{text('addresses')}</summary><div>{c.snapshot.device.addresses.map(value=><code key={value}>{value}</code>)}</div></details>}
      </div>}
      {!paired&&<p className="sf-pair-security"><AppIcon name="ShieldCheck" size={14}/>{text('security')}</p>}
    </div>
  </Dialog>;
}
