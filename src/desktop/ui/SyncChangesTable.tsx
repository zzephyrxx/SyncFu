// shadcn Table + TanStack row model for the real synchronization plan.
// Real Plan changes, controlled full-path selection, all-matching (not page-only)
// header selection; no customer fixtures, dates, purchase toggles or inert menus.
import {useMemo,useState} from 'react';
import {flexRender,getCoreRowModel,getPaginationRowModel,getSortedRowModel,useReactTable,type ColumnDef,type SortingState} from '@tanstack/react-table';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '../../components/ui/table';
import {Checkbox} from '../../components/ui/selection';
import {Button,IconButton} from './UI';
import {AppIcon} from './icons';
import {usePrototype} from '../../prototype/context';
import type {Change,Plan} from '../../types';
import type {DesktopController} from '../controller';
import {FileIdentity} from '../FileIdentity';
import {fileIdentity} from '../focus-model';
import {groupSelection,rowKey,rowSelectionRecord,selectionFromRecord,selectable,toggleGroup} from '../batch-selection';
import {deviceDisplayName} from '../device-metadata';
import {useDeviceProfiles} from '../useDeviceProfiles';
export function SyncChangesTable({c,plan,rows,page,onPage,showLocations,onConflict}:{c:DesktopController;plan:Plan;rows:Change[];page:number;onPage:(page:number)=>void;showLocations:boolean;onConflict:(path:string)=>void}){
  const {t,bytes,number}=usePrototype();const {profiles}=useDeviceProfiles();const [sorting,setSorting]=useState<SortingState>([]);
  const locked=c.busy||c.reviewStale||Boolean(c.prepared);const record=useMemo(()=>rowSelectionRecord(c.selected),[c.selected]);
  const selected=groupSelection(rows,c.selected);const peer=c.snapshot.peers.find(p=>p.id===plan.task.peer);
  const duplicates=useMemo(()=>{const seen=new Set<string>(),duplicates=new Set<string>();for(const change of plan.comparison.changes){const name=fileIdentity(change.path).name;if(seen.has(name))duplicates.add(name);seen.add(name);}return duplicates;},[plan.comparison.changes]);
  const columns=useMemo<ColumnDef<Change>[]>(()=>[
    {id:'select',header:()=> <Checkbox aria-label={t('selectFiltered')} isDisabled={locked||!selected.total} isSelected={selected.checked} isIndeterminate={selected.mixed} onChange={()=>c.setSelected(old=>toggleGroup(rows,old))}/>,cell:({row})=><Checkbox aria-label={t('selectFile',{path:row.original.path})} isDisabled={locked||!selectable(row.original,c.scope)} isSelected={row.getIsSelected()} onChange={value=>row.toggleSelected(value)}/>,enableSorting:false},
    {id:'name',accessorFn:change=>change.path,header:t('filename'),cell:({row})=>{const change=row.original;return <FileIdentity path={change.path} directory={(change.after??change.before)?.type==='directory'} showPath={showLocations||duplicates.has(fileIdentity(change.path).name)}/>;}},
    {id:'target',accessorFn:change=>change.target,header:t('destinationShort'),cell:({row})=>row.original.action==='conflict'?<span className="sf-muted">—</span>:<span className="sf-destination" title={row.original.target===0?c.snapshot.device.name:peer?.name??plan.task.peer}><AppIcon name={row.original.target===0?'ArrowLeft':'ArrowRight'} size={15}/><span>{row.original.target===0?profiles[c.snapshot.device.id]?.alias||t('local'):peer?deviceDisplayName(peer,profiles):plan.task.peer}</span></span>},
    {id:'action',accessorKey:'action',header:t('actionShort'),cell:({row})=>{const change=row.original,resolved=plan.resolutions.some(r=>r.conflict.path===change.path);return change.action==='conflict'||resolved?plan.undo_of?<span className="sf-muted">{t('later')}</span>:<Button variant="ghost" size="small" className="sf-compare" disabled={locked||Boolean(c.snapshot.phase)||Boolean(c.snapshot.policy_states.find(p=>p.task===plan.task.id)?.state.pending)} onClick={()=>onConflict(change.path)}><AppIcon name={resolved?'Check':'AlertTriangle'} size={15}/>{t(resolved?'decided':'compareShort')}</Button>:<span className={`sf-action ${change.action}`}><i/>{t(change.action==='update'?'changeUpdate':change.action)}</span>;}},
    {id:'size',accessorFn:change=>{const entry=change.after??change.before;return entry?.type==='file'?entry.bytes:0;},header:t('size'),cell:({row})=>{const entry=row.original.after??row.original.before;return <span className="sf-size">{entry?.type==='file'?bytes(entry.bytes):'—'}</span>;}},
  ],[t,bytes,locked,selected.checked,selected.mixed,selected.total,c.selected,c.scope,c.snapshot,plan,rows,showLocations,duplicates,peer,profiles,onConflict]);
  const count=Math.max(1,Math.ceil(rows.length/50)),current=Math.max(0,Math.min(page,count-1));
  const table=useReactTable({data:rows,columns,getRowId:change=>rowKey(change.path),state:{sorting,rowSelection:record,pagination:{pageIndex:current,pageSize:50}},enableRowSelection:row=>!locked&&selectable(row.original,c.scope),onRowSelectionChange:updater=>c.setSelected(old=>selectionFromRecord(typeof updater==='function'?updater(rowSelectionRecord(old)):updater,plan,c.scope)),onSortingChange:updater=>{setSorting(updater);onPage(0);},getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getPaginationRowModel:getPaginationRowModel(),autoResetPageIndex:false});
  return <><div className="sf-table-scroll"><Table aria-label={t('changes')} className="bui-table bui-table-sm sf-changes-table">
    <TableHeader><TableRow>{table.getFlatHeaders().map(header=><TableHead key={header.id} scope="col" aria-sort={header.column.getIsSorted()==='asc'?'ascending':header.column.getIsSorted()==='desc'?'descending':undefined} className={`sf-col-${header.id}`}>{header.column.getCanSort()?<button type="button" className="sf-sort" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header,header.getContext())}<AppIcon name={header.column.getIsSorted()==='asc'?'ArrowUp':header.column.getIsSorted()==='desc'?'ArrowDown':'ArrowDownUp'} size={12}/></button>:flexRender(header.column.columnDef.header,header.getContext())}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{!rows.length&&<TableRow><TableCell colSpan={5}><div className="sf-table-empty"><AppIcon name="Search" size={24}/>{t('noResults')}</div></TableCell></TableRow>}{table.getRowModel().rows.map(row=><TableRow key={row.id} className={row.original.action==='conflict'?'sf-conflict-row':undefined} data-chosen={row.getIsSelected()} style={row.getIsSelected()?{backgroundColor:'var(--color-background-selected)'}:undefined}>{row.getVisibleCells().map(cell=><TableCell key={cell.id} className={`sf-col-${cell.column.id}`}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
  </Table></div>{count>1&&<div className="sf-pagination"><span>{number(rows.length)} {t('changes')}</span><div><IconButton label={t('back')} size="small" disabled={!current} onClick={()=>onPage(current-1)}><AppIcon name="ChevronLeft" size={16}/></IconButton><span>{current+1}/{count}</span><IconButton label={t('next')} size="small" disabled={current>=count-1} onClick={()=>onPage(current+1)}><AppIcon name="ChevronRight" size={16}/></IconButton></div></div>}</>;
}
