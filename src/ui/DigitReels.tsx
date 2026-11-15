"use client";
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { motionTokens } from '../prototype/motion';
export function Reel({digit,index,animate,expired,classPrefix='p'}:{digit:number;index:number;animate:boolean;expired:boolean;classPrefix?:'p'|'ui'}) {
  const ref=useRef<HTMLDivElement>(null);const [height,setHeight]=useState(80);
  useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(entries=>setHeight(entries[0].contentRect.height));observer.observe(ref.current);return()=>observer.disconnect();},[]);
  return <div className={`${classPrefix}-reel`} ref={ref}>{animate?<motion.div className={`${classPrefix}-reel-strip`} initial={{y:0}} animate={{y:-(30+digit)*height}} transition={{duration:motionTokens.duration.crawl,delay:index*motionTokens.duration.fast,ease:motionTokens.easing.smooth}}>{Array.from({length:40},(_,n)=><span key={n} style={{height}}>{n%10}</span>)}</motion.div>:<span className={`${classPrefix}-reel-final`}>{expired?'–':digit}</span>}</div>;
}
