"use client";
// Dot batching and 14-level luminance ramp adapted from caffeine-day/caffeine.js.
// MIT © 2026 Charles Postiaux. No caffeine model, URL state or global keyboard listeners.
import {useEffect,useRef} from 'react';
import {useMotionAllowed} from '../../prototype/motion';
export function DotStatus({running,label,detail,done,total}:{running:boolean;label:string;detail?:string;done?:number;total?:number}){
  const canvas=useRef<HTMLCanvasElement>(null);const allowed=useMotionAllowed();
  useEffect(()=>{
    const element=canvas.current;if(!element)return;const ctx=element.getContext('2d');if(!ctx)return;
    const dpr=Math.min(window.devicePixelRatio||1,2);element.width=92*dpr;element.height=32*dpr;ctx.scale(dpr,dpr);
    const levels=14,greys=Array.from({length:levels},(_,i)=>{const g=Math.round(44+194*(i/(levels-1))**1.05);return `rgb(${g},${g},${g})`;});
    const buckets:number[][]=Array.from({length:levels},()=>[]);let frame=0,alive=true;
    const paint=(list:number[])=>{ctx.beginPath();for(let n=0;n<list.length;n+=3){const r=list[n+2];if(r<1)ctx.rect(list[n]-r,list[n+1]-r,r*2,r*2);else{ctx.moveTo(list[n]+r,list[n+1]);ctx.arc(list[n],list[n+1],r,0,Math.PI*2);}}ctx.fill();};
    const visible=()=>!document.hidden&&element.getClientRects().length>0;
    const draw=(time:number)=>{if(!alive||!visible())return;ctx.clearRect(0,0,92,32);for(const b of buckets)b.length=0;
      const measured=typeof done==='number'&&typeof total==='number'&&total>0;const ratio=measured?Math.max(0,Math.min(1,done/total!)):0;
      for(let x=0;x<15;x++)for(let y=0;y<5;y++){
        const wave=running&&allowed?(Math.floor(time/100)+y)%15:x;
        const lit=measured?x<ratio*15:running?Math.abs(x-wave)<2:(x>=5&&x<=9&&(y===2||x===8&&y===1||x===8&&y===3));
        buckets[lit?12:2].push(4+x*6,4+y*6,lit?1.55:1.15);
      }
      for(let l=0;l<levels;l++)if(buckets[l].length){ctx.fillStyle=greys[l];paint(buckets[l]);}
      if(running&&allowed&&!document.hidden)frame=requestAnimationFrame(draw);
    };
    const visibility=()=>{cancelAnimationFrame(frame);draw(performance.now());};
    const observer=new ResizeObserver(visibility);observer.observe(element);
    document.addEventListener('visibilitychange',visibility);draw(performance.now());
    return()=>{alive=false;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',visibility);};
  },[running,allowed,done,total]);
  return <div className="material-status" role="status"><span className="material-dot-screen"><canvas ref={canvas} aria-hidden="true"/></span><span><strong>{label}</strong>{detail&&<small>{detail}</small>}</span></div>;
}
