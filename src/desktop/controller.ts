import {useCallback,useEffect,useRef,useState} from 'react';
import {canConfirm,decisionSelection,requireProtocol} from './selection';
import {recheckSelection} from './focus-model';
import {clipSelection,type ExecutionScope} from './batch-selection';
import {syncAttempt,validatePreview,type SyncPayload} from './sync-flow';
import {command,emptySnapshot,errorText} from '../api';
import type {Batch,Plan,Snapshot} from '../types';
import type {DecisionRequest,ExecutionPreview,UsageReport} from '../generated/policy';
import {useExecutionProgress} from './useExecutionProgress';
export type Transport=<T>(name:string,args?:Record<string,unknown>)=>Promise<T>;
export type Activity='idle'|'scan'|'resolve'|'prepare'|'execute'|'policy'|'other';
export interface Prepared extends SyncPayload {epoch:number}
export function useDesktopController(transport:Transport=command){
  const {progress,refreshProgress}=useExecutionProgress(transport);
  const [dismissedBatch,setDismissedBatch]=useState<string|null>(null);
  const execution=progress.summary?.batch===dismissedBatch?null:progress.summary;
  const [snapshot,setSnapshot]=useState<Snapshot>(emptySnapshot);const snapshotRef=useRef(snapshot);
  const [active,setActive]=useState('');const activeRef=useRef('');
  const [plan,setPlanState]=useState<Plan|null>(null);const planRef=useRef<Plan|null>(null);
  const [selected,setSelectedState]=useState(new Set<string>());const selectedRef=useRef(selected);
  const [scope,setScopeState]=useState<ExecutionScope>('all');const scopeRef=useRef<ExecutionScope>('all');
  const [prepared,setPreparedState]=useState<Prepared|null>(null);const preparedRef=useRef<Prepared|null>(null);
  const [busy,setBusy]=useState(false);const operation=useRef(false);const [activity,setActivity]=useState<Activity>('idle');
  const [reviewStale,setReviewStaleState]=useState(false);const staleRef=useRef(false);
  const [controlBusy,setControlBusy]=useState(false);const controlLock=useRef(false);
  const [error,setError]=useState('');const [result,setResult]=useState<Batch|null>(null);
  const [usage,setUsage]=useState<UsageReport>({enabled:true,records:[]});const [usageReady,setUsageReady]=useState(false);const [usageError,setUsageError]=useState('');
  const [checkGeneration,setCheckGeneration]=useState(0);
  const epoch=useRef(0),snapshotSequence=useRef(0),appliedSequence=useRef(0),usageSequence=useRef(0);
  const mounted=useRef(true);const lastReview=useRef<{plan:Plan;selected:Set<string>}|null>(null);
  const putPlan=(value:Plan|null)=>{planRef.current=value;setPlanState(value);};
  const putSelected=(value:Set<string>)=>{const copy=new Set(value);selectedRef.current=copy;setSelectedState(copy);if(planRef.current)lastReview.current={plan:planRef.current,selected:copy};};
  const putPrepared=(value:Prepared|null)=>{preparedRef.current=value;setPreparedState(value);};
  const putStale=(value:boolean)=>{staleRef.current=value;setReviewStaleState(value);};
  const resetScope=()=>{scopeRef.current='all';setScopeState('all');};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  const refresh=useCallback(async()=>{
    const sequence=++snapshotSequence.current;const next=await transport<Snapshot>('snapshot');
    if(!mounted.current||sequence<appliedSequence.current)return;
    try{requireProtocol(next.protocol);}catch(e){epoch.current++;snapshotRef.current=emptySnapshot;setSnapshot(emptySnapshot);putPlan(null);putPrepared(null);putSelected(new Set());throw e;}
    appliedSequence.current=sequence;snapshotRef.current=next;setSnapshot(next);
    if(!next.tasks.some(task=>task.id===activeRef.current)){
      const id=next.tasks[0]?.id??'';activeRef.current=id;setActive(id);epoch.current++;putPlan(null);putPrepared(null);putSelected(new Set());resetScope();
    }
    const direction=next.policy_states.find(view=>view.task===activeRef.current)?.state.current.direction;
    if(direction&&direction.mode!=='bidirectional'){
      const required:ExecutionScope=direction.source_device===next.device.id?'send':'receive';
      if(scopeRef.current!==required){epoch.current++;scopeRef.current=required;setScopeState(required);putPrepared(null);if(planRef.current)putSelected(clipSelection(planRef.current,selectedRef.current,required));}
    }
  },[transport]);
  const refreshUsage=useCallback(async()=>{
    const sequence=++usageSequence.current;
    try{const next=await transport<UsageReport>('usage_report');if(mounted.current&&sequence===usageSequence.current){setUsage(next);setUsageReady(true);setUsageError('');}}
    catch(e){if(mounted.current&&sequence===usageSequence.current)setUsageError(errorText(e));throw e;}
  },[transport]);
  const run=useCallback(async(action:()=>Promise<unknown>,kind:Activity='other')=>{
    if(operation.current)return false;operation.current=true;setBusy(true);setActivity(kind);setError('');
    try{await action();await refresh();return true;}
    catch(e){if(mounted.current)setError(errorText(e));try{await refresh();}catch{/* Preserve the original operation error. */}return false;}
    finally{operation.current=false;if(mounted.current){setBusy(false);setActivity('idle');}}
  },[refresh]);
  useEffect(()=>{
    void refresh().catch(e=>{if(mounted.current)setError(errorText(e));});void refreshUsage().catch(()=>{});
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{if(cancelled)return;try{await refresh();}catch(e){if(!cancelled)setError(errorText(e));}finally{if(!cancelled)timer=setTimeout(poll,1600);}};
    timer=setTimeout(poll,1600);return()=>{cancelled=true;clearTimeout(timer);};
  },[refresh,refreshUsage]);
  const historyRevision=snapshot.history.map(batch=>`${batch.id}:${batch.status}:${batch.done}`).join('|');
  useEffect(()=>{if(historyRevision)void refreshUsage().catch(()=>{});},[historyRevision,refreshUsage]);
  const invalidate=()=>{epoch.current++;putPlan(null);putPrepared(null);putSelected(new Set());setCheckGeneration(n=>n+1);};
  useEffect(()=>{
    if(!plan)return;const current=snapshot.policy_states.find(p=>p.task===plan.task.id);
    if(current&&(current.state.pending||current.state.current.revision!==plan.policy.revision))invalidate();
  },[snapshot.policy_states,plan]);
  const openTask=(id:string,force=false)=>{
    if(operation.current&&!force)return;
    if(id!==activeRef.current){activeRef.current=id;setActive(id);epoch.current++;putPlan(null);putPrepared(null);putSelected(new Set());setResult(null);resetScope();}
    setError('');
  };
  const inspect=(task=activeRef.current,undo?:string)=>run(async()=>{
    setResult(null);
    if(undo||task!==activeRef.current)resetScope();
    const version=++epoch.current;const previous=lastReview.current;putPrepared(null);putStale(true);
    const latestProgress=await refreshProgress().catch(()=>null);
    if(!mounted.current||version!==epoch.current)return;
    setDismissedBatch(latestProgress?.summary?.batch??snapshotRef.current.execution?.batch??null);
    const next=await transport<Plan>(undo?'inspect_undo':'inspect_task',undo?{batch:undo}:{task});
    if(!mounted.current||version!==epoch.current)return;
    activeRef.current=next.task.id;setActive(next.task.id);putPlan(next);
    putSelected(clipSelection(next,recheckSelection(next,previous),scopeRef.current));putStale(false);
  },'scan');
  useEffect(()=>{if(execution&&plan?.task.id===execution.task){putStale(true);putPrepared(null);}},[execution?.batch,plan?.id]);
  const setSelected=(value:Set<string>|((old:Set<string>)=>Set<string>))=>{
    const current=planRef.current;if(!current||operation.current||preparedRef.current||staleRef.current)return;
    const next=typeof value==='function'?value(new Set(selectedRef.current)):value;
    putSelected(clipSelection(current,next,scopeRef.current));
  };
  const changeScope=(value:ExecutionScope)=>{
    if(operation.current||!['all','send','receive'].includes(value))return;
    const direction=snapshotRef.current.policy_states.find(view=>view.task===activeRef.current)?.state.current.direction;
    if(direction&&direction.mode!=='bidirectional'){
      const required:ExecutionScope=direction.source_device===snapshotRef.current.device.id?'send':'receive';
      if(value!=='all'&&value!==required)return;value=required;
    }
    if(value===scopeRef.current)return;
    epoch.current++;scopeRef.current=value;setScopeState(value);putPrepared(null);
    if(planRef.current)putSelected(clipSelection(planRef.current,selectedRef.current,value));
  };
  const setPrepared=(value:null)=>{if(value===null&&preparedRef.current){epoch.current++;putPrepared(null);}};
  const decide=(decisions:DecisionRequest[])=>run(async()=>{
    const current=planRef.current;if(!current||staleRef.current)throw new Error('请先重新检查文件。');
    const version=++epoch.current;putPrepared(null);
    const next=await transport<Plan>('resolve_plan',{plan:current.id,digest:current.digest,decisions});
    if(!mounted.current||version!==epoch.current)return;
    const old=selectedRef.current;putPlan(next);putSelected(clipSelection(next,decisionSelection(next,old,decisions),scopeRef.current));
  },'resolve');
  const complete=async(batch:Batch)=>{
    if(!mounted.current)return;setResult(batch);putStale(true);putPrepared(null);putSelected(new Set());epoch.current++;
    await refreshProgress().catch(()=>{});
    await refreshUsage().catch(()=>{});
  };
  const synchronize=(forceReview:boolean)=>run(async()=>{
    const current=planRef.current,chosen=new Set(selectedRef.current),chosenScope=scopeRef.current,version=epoch.current;
    if(!current||staleRef.current||snapshotRef.current.phase||!canConfirm(snapshotRef.current,current,[...chosen]))throw new Error('当前清单暂不可执行，请检查连接、规则或暂停状态。');
    const attempt=await syncAttempt({plan:current,selected:chosen,scope:chosenScope,forceReview,
      current:()=>mounted.current&&epoch.current===version&&planRef.current?.id===current.id&&scopeRef.current===chosenScope&&!staleRef.current&&canConfirm(snapshotRef.current,current,[...chosen]),
      preview:selection=>transport<ExecutionPreview>('preview_execution',{plan:current.id,digest:current.digest,selected:selection}),
      refresh,
      execute:preview=>transport<Batch>('execute_plan',{plan:current.id,digest:current.digest,selected:preview.selected,approveRisk:false}),
      phase:setActivity,
    });
    if(attempt.kind==='review'){putSelected(new Set(attempt.payload.preview.selected));putPrepared({...attempt.payload,epoch:version});}
    else if(attempt.kind==='executed')await complete(attempt.batch);
    else if(mounted.current)setError('清单或状态已变化，未执行同步。请重新检查。');
  },'prepare');
  // Compatibility for callers that explicitly ask for a read-only preview.
  const prepare=()=>synchronize(true);const syncSelected=()=>synchronize(false);
  const execute=(approveRisk:boolean)=>run(async()=>{
    const approved=preparedRef.current;if(!approved)return;await refresh();
    if(approved.epoch!==epoch.current||planRef.current?.id!==approved.plan.id||scopeRef.current!==approved.scope||!canConfirm(snapshotRef.current,approved.plan,approved.preview.selected))throw new Error('确认已失效，请重新检查。');
    validatePreview(approved.plan,approved.scope,approved.preview);putPrepared(null);
    const batch=await transport<Batch>('execute_plan',{plan:approved.plan.id,digest:approved.plan.digest,selected:approved.preview.selected,approveRisk});await complete(batch);
  },'execute');
  const pause=async(task:string,paused:boolean)=>{
    if(controlLock.current)return;controlLock.current=true;setControlBusy(true);
    try{await transport('pause_task',{task,paused});invalidate();await refresh();}
    catch(e){if(mounted.current)setError(errorText(e));}
    finally{controlLock.current=false;if(mounted.current)setControlBusy(false);}
  };
  return {execution,progress,snapshot,active,plan,selected,setSelected,scope,changeScope,checkGeneration,busy,activity,reviewStale,controlBusy,pause,error,setError,result,setResult,usage,usageReady,usageError,prepared,setPrepared,openTask,inspect,decide,prepare,syncSelected,execute,run,refresh,refreshUsage,invalidate,transport};
}
export type DesktopController=ReturnType<typeof useDesktopController>;
export function useTaskAutoCheck(c:DesktopController,enabled:boolean){
  const gate=useRef({task:'',visit:0,online:false,connection:0,attempt:''});
  useEffect(()=>{
    const task=c.snapshot.tasks.find(item=>item.id===c.active),view=c.snapshot.policy_states.find(item=>item.task===task?.id);
    const online=Boolean(c.snapshot.peers.find(peer=>peer.id===task?.peer)?.online),state=gate.current;
    if(state.task!==c.active){state.task=c.active;state.visit++;state.online=false;}if(online&&!state.online)state.connection++;state.online=online;
    if(!enabled||!task||!view||!online||c.busy||c.prepared||c.snapshot.phase||view.paused||c.snapshot.paused_all||view.state.pending||c.snapshot.history.some(batch=>batch.status==='pending'))return;
    const key=`${task.id}:${state.visit}:${view.state.current.revision}:${state.connection}:${c.checkGeneration}`;if(state.attempt===key)return;state.attempt=key;
    if(c.plan?.undo_of)return;void c.inspect(task.id);
  });
}
