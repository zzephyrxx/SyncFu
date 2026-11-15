import type {Change,Plan} from '../types.ts';
export type ExecutionScope='all'|'send'|'receive';
export function inScope(change:Change,scope:ExecutionScope){
  // An unresolved conflict has no authoritative target yet. Keep it visible,
  // but never select it as an executable operation.
  return change.action==='conflict'||scope==='all'||change.target===(scope==='send'?1:0);
}
export function selectable(change:Change,scope:ExecutionScope){return ['create','update','delete'].includes(change.action)&&(change.target===0||change.target===1)&&inScope(change,scope);}
export function clipSelection(plan:Plan,selected:Iterable<string>,scope:ExecutionScope){
  const allowed=new Set(plan.comparison.changes.filter(c=>selectable(c,scope)).map(c=>c.path));
  return new Set([...selected].filter(path=>allowed.has(path)));
}
export function matchingChanges(plan:Plan,scope:ExecutionScope,search:string){
  const term=search.trim().toLocaleLowerCase();return plan.comparison.changes.filter(c=>inScope(c,scope)&&c.path.toLocaleLowerCase().includes(term));
}
export function groupSelection(changes:Change[],selected:ReadonlySet<string>){
  const eligible=changes.filter(c=>c.action!=='conflict');const count=eligible.filter(c=>selected.has(c.path)).length;
  return {total:eligible.length,selected:count,checked:eligible.length>0&&count===eligible.length,mixed:count>0&&count<eligible.length};
}
export function toggleGroup(changes:Change[],selected:ReadonlySet<string>){
  const state=groupSelection(changes,selected);const next=new Set(selected);
  for(const c of changes)if(c.action!=='conflict'){if(state.checked)next.delete(c.path);else next.add(c.path);}
  return next;
}
// Prefix even full-path IDs: table libraries may use ordinary objects internally.
// This keeps valid files named __proto__/constructor out of prototype slots.
export const rowKey=(path:string)=>`path:${path}`;
export function rowSelectionRecord(selected:ReadonlySet<string>){
  const record:Record<string,boolean>=Object.create(null);for(const key of selected)record[rowKey(key)]=true;return record;
}
export function selectionFromRecord(record:Record<string,boolean>,plan:Plan,scope:ExecutionScope){
  return clipSelection(plan,Object.entries(record).filter(([key,value])=>value===true&&key.startsWith('path:')).map(([key])=>key.slice(5)),scope);
}
