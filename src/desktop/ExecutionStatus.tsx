import type {ExecutionProgress} from '../types';
import type {MessageKey} from '../prototype/messages';
import {usePrototype} from '../prototype/context';
import {AppIcon} from './ui/icons';
import './execution-status.css';
export function ExecutionStatus({progress}:{progress:ExecutionProgress}){
  const {t,bytes,number}=usePrototype();const p=progress;
  const stages:Record<string,MessageKey>={completed:'resultCompleted',partial:'resultPartial',failed:'resultFailed',cancelled:'resultCancelled',pending:'resultPending',interrupted:'resultPending',backup:'progressBackup',transfer:'fileTransferring',verify:'progressVerify',apply:'progressApply',reconcile:'progressReconcile'};
  return <section className="sf-execution-status" aria-label={t('syncProgress')}>
    <header><strong><AppIcon name={p.running?'RefreshCw':p.stage==='completed'?'CheckCircle2':'ShieldAlert'} size={17}/>{t('syncProgress')}</strong><span>{t('progressCount',{done:number(p.done),total:number(p.total)})}</span></header>
    <progress aria-label={t('syncProgress')} max={Math.max(1,p.total)} value={p.done}/>
    <div className="sf-execution-details"><span>{t(stages[p.stage]??'progressReconcile')}</span>{p.total_bytes>0&&<span>{t('progressTransfer',{done:bytes(p.transferred_bytes),total:bytes(p.total_bytes)})}</span>}</div>
    {p.running&&p.current_path&&<div className="sf-execution-current"><span title={p.current_path}>{p.current_path}</span>{p.stage==='transfer'&&p.current_total>0&&<><span>{Math.min(100,Math.floor(p.current_bytes/p.current_total*100))}%</span><progress aria-label={p.current_path} max={p.current_total} value={p.current_bytes}/></>}</div>}
    <p>{t('progressHelp')}</p>
  </section>;
}
