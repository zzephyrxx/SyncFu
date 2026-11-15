import {useState} from 'react';
import {CheckCircle2,Clock3,Folder,History,RotateCcw} from '../boardui/glyphs';
import {Art,Button,Dialog,Spinner} from '../boardui/UI';
import {usePrototype} from '../../prototype/context';
import type {MessageKey} from '../../prototype/messages';
import type {Batch,Plan} from '../../types';
import type {DesktopController} from '../controller';
import {handoffBlock} from '../selection';
export function batchStatus(batch:Batch):MessageKey{return batch.status==='completed'?'resultCompleted':batch.status==='failed'?'resultFailed':batch.status==='cancelled'?'resultCancelled':batch.status==='pending'?'resultPending':'resultPartial';}
export function HistoryPage({c,onTask}:{c:DesktopController;onTask:()=>void}){
  const {t,date}=usePrototype();
  return <section className="sf-page"><header className="ui-page-heading"><h1>{t('history')}</h1><Button disabled={c.busy} onClick={()=>void c.run(c.refresh)}>{t('refresh')}</Button></header>
    {!c.snapshot.history.length?<div className="ui-centered"><Art kind="folder" size="large"/><h2>{t('noHistory')}</h2></div>:<div className="ui-history-list">{c.snapshot.history.map(batch=><article className="ui-history-item" key={batch.id}><span className={`ui-history-icon ${batch.status==='completed'?'completed':''}`}>{batch.status==='completed'?<CheckCircle2 size={21}/>:batch.status==='pending'?<Clock3 size={21}/>:<History size={21}/>}</span><div><time>{date(batch.created*1000)}</time><h2>{batch.label}</h2><p>{t(batchStatus(batch))} · {batch.done}/{batch.total}</p>{batch.message&&<p className="ui-history-error">{batch.message}</p>}</div>{batch.status==='pending'?<Button disabled={c.busy} onClick={()=>void c.run(async()=>{c.setResult(await c.transport('reconcile',{batch:batch.id}));})}>{t('reconcile')}</Button>:batch.undo_available&&c.snapshot.tasks.some(task=>task.id===batch.task)&&<Button disabled={c.busy||c.snapshot.history.some(b=>b.status==='pending')} onClick={()=>{onTask();void c.inspect(batch.task,batch.id);}}><RotateCcw size={15}/>{t('undo')}</Button>}</article>)}</div>}
  </section>;
}
export function HandoffDialog({c,onClose,onTask}:{c:DesktopController;onClose:()=>void;onTask:(id:string)=>void}){
  const {t}=usePrototype();const [target,setTarget]=useState(c.snapshot.peers[0]?.id??'');const [results,setResults]=useState<Record<string,string>>({});
  const tasks=c.snapshot.tasks.filter(task=>task.peer===target);
  const check=()=>void c.run(async()=>{const next:Record<string,string>={};for(const task of tasks){try{const block=handoffBlock(c.snapshot,task);if(block){next[task.id]=t(block);continue;}const plan=await c.transport<Plan>('inspect_task',{task:task.id});next[task.id]=plan.comparison.issues.length?plan.comparison.issues.join(' / '):plan.comparison.changes.length?t('changeCount',{n:plan.comparison.changes.length}):plan.review_notes.some(n=>n.ignored)?t('ignoredState'):t('ready');}catch(e){next[task.id]=String(e);}}setResults(next);});
  return <Dialog error={c.error} title={t('handoffLive')} onClose={onClose}><div className="ui-form"><label>{t('devices')}<select value={target} disabled={c.busy} onChange={e=>{setTarget(e.target.value);setResults({});}}>{c.snapshot.peers.map(peer=><option key={peer.id} value={peer.id}>{peer.name}</option>)}</select></label><p className="ui-body-copy">{t('handoffManual')}</p>{tasks.map(task=><div className="ui-ignored-row" key={task.id}><Folder size={18}/><div><strong>{task.label}</strong><span>{results[task.id]??t('notScanned')}</span></div><button disabled={c.busy} onClick={()=>onTask(task.id)}>{t('tasks')}</button></div>)}<div className="ui-modal-actions"><button onClick={onClose}>{t('close')}</button><button className="primary" disabled={c.busy||!tasks.length} onClick={check}>{c.busy?<Spinner/>:null}{t('checkHandoff')}</button></div></div></Dialog>;
}
