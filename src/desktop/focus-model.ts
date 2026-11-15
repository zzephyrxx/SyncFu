import type { Direction, TaskPolicy } from '../generated/policy.ts';
import type { Plan } from '../types.ts';
import { defaultSelection } from './selection.ts';

export function fileIdentity(path: string) {
  const parts=path.replaceAll('\\','/').split('/').filter(Boolean);
  return { name:parts.at(-1)??path, parent:parts.slice(0,-1).join('/'), full:path };
}
export function fileKind(path: string, directory=false): 'folder'|'pdf'|'image'|'code'|'text' {
  if(directory)return 'folder';
  const ext=path.split('.').at(-1)?.toLowerCase();
  if(ext==='pdf')return 'pdf';
  if(ext&&['png','jpg','jpeg','gif','webp','svg','heic'].includes(ext))return 'image';
  if(ext&&['ts','tsx','js','jsx','rs','py','json','toml','css','html','yaml','yml'].includes(ext))return 'code';
  return 'text';
}
export function nextDirection(policy: TaskPolicy, mode: Direction['mode'], source: string): TaskPolicy {
  if(!policy.endpoints.some(e=>e.device===source))throw new Error('Source is not a task endpoint');
  if(policy.revision>=0xffffffff)throw new Error('Policy revision exhausted');
  return {...policy,revision:policy.revision+1,direction:mode==='bidirectional'?{mode}:{mode,source_device:source},conflicts:mode!=='bidirectional'&&policy.conflicts.kind==='prefer_device'&&policy.conflicts.device!==source?{kind:'hold'}:policy.conflicts};
}
export function directionNeedsConfirmation(current: TaskPolicy, next: TaskPolicy) {
  if(next.direction.mode==='one_way_mirror')return JSON.stringify(current.direction)!==JSON.stringify(next.direction);
  return current.direction.mode!=='bidirectional'&&next.direction.mode!=='bidirectional'&&current.direction.source_device!==next.direction.source_device;
}
export function recheckSelection(next: Plan, previous: {plan:Plan;selected:Set<string>}|null) {
  const selected=defaultSelection(next);
  if(!previous||previous.plan.task.id!==next.task.id||previous.plan.undo_of!==next.undo_of)return selected;
  const old=new Map(previous.plan.comparison.changes.map(c=>[c.path,c]));
  for(const change of next.comparison.changes){
    if(old.has(change.path)&&!previous.selected.has(change.path))selected.delete(change.path);
    if(change.action==='delete'&&previous.selected.has(change.path)&&previous.plan.policy.digest===next.policy.digest&&JSON.stringify(old.get(change.path))===JSON.stringify(change))selected.add(change.path);
  }
  return selected;
}
