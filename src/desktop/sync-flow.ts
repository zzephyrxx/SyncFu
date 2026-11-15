import type {Batch,Plan} from '../types.ts';
import type {ExecutionPreview} from '../generated/policy.ts';
import {clipSelection,type ExecutionScope} from './batch-selection.ts';
export interface SyncPayload {plan:Plan;preview:ExecutionPreview;scope:ExecutionScope}
export type SyncAttempt={kind:'cancelled'}|{kind:'review';payload:SyncPayload}|{kind:'executed';batch:Batch};
export function requiresReview(plan:Plan,requested:ReadonlySet<string>,preview:ExecutionPreview){
  const final=new Set(preview.selected);
  if(plan.undo_of||preview.approval_required||final.size!==requested.size||[...final].some(path=>!requested.has(path)))return true;
  if(plan.comparison.changes.some(c=>final.has(c.path)&&c.action==='delete'))return true;
  return plan.resolutions.some(resolution=>final.has(resolution.conflict.path));
}
export function validatePreview(plan:Plan,scope:ExecutionScope,preview:ExecutionPreview){
  if(preview.plan!==plan.id||preview.digest!==plan.digest)throw new Error('预检与当前清单不一致，请重新检查。');
  if(!Array.isArray(preview.selected)||!preview.selected.length||preview.selected.some(p=>typeof p!=='string'))throw new Error('预检没有可执行的选择。');
  const allowed=clipSelection(plan,preview.selected,scope);
  if(allowed.size!==preview.selected.length)throw new Error('预检包含重复、冲突或范围外的项目，请重新检查。');
}
/** One user intent, one preview, at most one execution. No nested controller locks
 * and no read-after-setState race: the authoritative preview stays a local value. */
export async function syncAttempt(options:{
  plan:Plan;selected:ReadonlySet<string>;scope:ExecutionScope;
  current:()=>boolean;
  preview:(selected:string[])=>Promise<ExecutionPreview>;
  refresh:()=>Promise<void>;
  execute:(preview:ExecutionPreview)=>Promise<Batch>;
  forceReview?:boolean;
  phase?:(value:'prepare'|'execute')=>void;
}):Promise<SyncAttempt>{
  const {plan,scope}=options;const requested=new Set(options.selected);
  if(!requested.size||clipSelection(plan,requested,scope).size!==requested.size)throw new Error('选择已失效，请重新检查文件。');
  if(!options.current())return {kind:'cancelled'};
  options.phase?.('prepare');
  const preview=await options.preview([...requested]);
  if(!options.current())return {kind:'cancelled'};
  validatePreview(plan,scope,preview);
  await options.refresh();
  if(!options.current())return {kind:'cancelled'};
  const payload={plan,scope,preview:{...preview,selected:[...preview.selected]}};
  if(options.forceReview||requiresReview(plan,requested,preview))return {kind:'review',payload};
  options.phase?.('execute');
  return {kind:'executed',batch:await options.execute(payload.preview)};
}
