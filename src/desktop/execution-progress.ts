import type {ExecutionProgress,FileProgressState,ProgressPage} from '../types.ts';
export interface ProgressState {summary:ExecutionProgress|null;files:ReadonlyMap<string,FileProgressState>;cursor:number}
export const emptyProgress:ProgressState={summary:null,files:new Map(),cursor:0};
// reuseFiles is only for an unpublished accumulator owned by the caller.
export function mergeProgress(previous:ProgressState,page:ProgressPage,reuseFiles=false):ProgressState {
  if(!page.summary)return emptyProgress;
  const same=previous.summary?.batch===page.summary.batch;
  // Ignore a late page from the same batch instead of erasing newer outcomes.
  if(same&&page.cursor<previous.cursor)return previous;
  if(same&&page.cursor===previous.cursor&&!page.events.length&&JSON.stringify(page.summary)===JSON.stringify(previous.summary))return previous;
  const files=same&&(!page.events.length||reuseFiles)?previous.files:new Map(same?previous.files:[]);
  if(page.events.length){const updated=files as Map<string,FileProgressState>;for(const event of page.events)if(updated.get(event.path)!=='applied')updated.set(event.path,event.state);}
  return {summary:page.summary,files,cursor:page.cursor};
}
