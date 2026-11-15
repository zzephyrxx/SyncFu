import {useCallback,useEffect,useRef,useState} from 'react';
import type {ProgressPage} from '../types';
import type {Transport} from './controller';
import {emptyProgress,mergeProgress,type ProgressState} from './execution-progress';
export function useExecutionProgress(transport:Transport){
  const [progress,setProgress]=useState(emptyProgress);const state=useRef(emptyProgress);const inflight=useRef<Promise<ProgressState>|null>(null);const mounted=useRef(true);
  const refreshProgress=useCallback(()=>{
    if(inflight.current)return inflight.current;
    const read=async()=>{
      // Drain bounded pages; yield between groups so large lists cannot monopolize the UI.
      let more=true,pending=state.current,owned=false;
      while(more&&mounted.current){
        for(let i=0;i<8&&more;i++){
          const current=pending;
          const page=await transport<ProgressPage>('execution_progress',{batch:current.summary?.batch??null,after:current.cursor});
          if(!mounted.current)return state.current;
          const next=mergeProgress(pending,page,owned);
          owned=owned||next.files!==pending.files;pending=next;more=page.more;
        }
        if(more)await new Promise<void>(resolve=>setTimeout(resolve,16));
      }
      // Publish once after draining. Only the first page copies the previous
      // immutable map; later pages update the private accumulator in linear time.
      if(mounted.current){state.current=pending;setProgress(pending);}
      return state.current;
    };
    const pending=read().finally(()=>{inflight.current=null;});inflight.current=pending;return pending;
  },[transport]);
  useEffect(()=>{
    mounted.current=true;let timer:ReturnType<typeof setTimeout>;let cancelled=false;
    const poll=async()=>{try{await refreshProgress();}catch{/* A progress fetch must not interrupt an approved sync. */}finally{if(!cancelled)timer=setTimeout(poll,700);}};
    void poll();return()=>{mounted.current=false;cancelled=true;clearTimeout(timer);};
  },[refreshProgress]);
  return {progress,refreshProgress};
}
