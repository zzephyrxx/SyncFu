import {CheckCircle2,Clock3,History,RotateCcw} from '../ui/glyphs';
import {Art,Button} from '../ui/UI';
import {usePrototype} from '../../prototype/context';
import type {MessageKey} from '../../prototype/messages';
import type {Batch} from '../../types';
import type {DesktopController} from '../controller';
export function batchStatus(batch:Batch):MessageKey{return batch.status==='completed'?'resultCompleted':batch.status==='failed'?'resultFailed':batch.status==='cancelled'?'resultCancelled':batch.status==='pending'?'resultPending':'resultPartial';}
export function HistoryPage({c,onTask}:{c:DesktopController;onTask:()=>void}){
  const {t,date}=usePrototype();
  return <section className="sf-page"><header className="ui-page-heading"><h1>{t('history')}</h1><Button disabled={c.busy} onClick={()=>void c.run(c.refresh)}>{t('refresh')}</Button></header>
    {!c.snapshot.history.length?<div className="ui-centered"><Art kind="folder" size="large"/><h2>{t('noHistory')}</h2></div>:<div className="ui-history-list">{c.snapshot.history.map(batch=><article className="ui-history-item" key={batch.id}><span className={`ui-history-icon ${batch.status==='completed'?'completed':''}`}>{batch.status==='completed'?<CheckCircle2 size={21}/>:batch.status==='pending'?<Clock3 size={21}/>:<History size={21}/>}</span><div><time>{date(batch.created*1000)}</time><h2>{batch.label}</h2><p>{t(batchStatus(batch))} · {batch.done}/{batch.total}</p>{batch.message&&<p className="ui-history-error">{batch.message}</p>}</div>{batch.status==='pending'?<Button disabled={c.busy} onClick={()=>void c.run(async()=>{c.setResult(await c.transport('reconcile',{batch:batch.id}));})}>{t('reconcile')}</Button>:batch.undo_available&&c.snapshot.tasks.some(task=>task.id===batch.task)&&<Button disabled={c.busy||c.snapshot.history.some(b=>b.status==='pending')} onClick={()=>{onTask();void c.inspect(batch.task,batch.id);}}><RotateCcw size={15}/>{t('undo')}</Button>}</article>)}</div>}
  </section>;
}
