import Desktop from '../desktop/Desktop';
import type { Transport } from '../desktop/controller';
import type { Snapshot, Plan, Settings, Batch } from '../types';
import { wireProtocol } from '../generated/policy';
import type { TaskPolicy, UsageReport } from '../generated/policy';
// Development-only integration fixture. Never imported by a production bundle.
const local='a'.repeat(64),remote='b'.repeat(64),taskId='c'.repeat(64);
const policy:TaskPolicy={task:taskId,revision:1,endpoints:[{device:local,grant:'local-grant'},{device:remote,grant:'remote-grant'}],direction:{mode:'bidirectional'},trigger:'manual',trust:{kind:'personal'},conflicts:{kind:'hold'},excludes:[],deletion:{max_files:100,relative_min:10,percent:20,window_seconds:600}};
const snapshot:Snapshot={protocol:wireProtocol,device:{id:local,name:'MacBook Air',port:47657,addresses:['127.0.0.1:47657']},peers:[{id:remote,name:'Windows PC',address:'127.0.0.1:47658',online:true}],nearby:[],pending:[],tasks:[{id:taskId,peer:remote,local:'local-grant',remote:'remote-grant',label:'工作资料',local_path:'/fixture/local',remote_path:'D:\\fixture'}],history:[],dirty:[taskId],phase:null,network_error:null,policy_states:[{task:taskId,state:{current:policy,pending:null,last_receipt:null},paused:false}],paused_all:false,automatic_supported:false};
// Explicit development scenarios exercise discovery, long hostnames and offline states.
const scenario=new URLSearchParams(window.location.search).get('scenario');
if(scenario==='lan')snapshot.nearby=[{id:'d'.repeat(64),name:'设计工作站',address:'192.168.1.26:47657'},{id:'e'.repeat(64),name:'客厅 MacBook',address:'192.168.1.38:47657'}];
if(scenario==='offline')snapshot.peers[0].online=false;
if(scenario==='long-names'){snapshot.device.name='Design-Review-MacBook-Pro.local';snapshot.peers[0].name='OFFICE-DESKTOP';snapshot.tasks[0].local_path='/Users/example/Documents/示例项目文档与跨设备同步测试';snapshot.tasks[0].remote_path='D:\\Documents\\示例项目文档与跨设备同步测试';}
const file=(bytes:number,sha:string)=>({type:'file' as const,bytes,sha256:sha.repeat(64)});
let plan:Plan={id:'fixture-plan-0',task:snapshot.tasks[0],digest:'fixture-digest-0',policy:{revision:1,digest:'policy-fixture'},undo_of:null,comparison:{same:4,total:12,ignored:0,issues:[],changes:[{path:'notes/new.md',action:'create',target:1,before:null,after:file(12,'a')},{path:'notes/draft.md',action:'conflict',target:0,before:file(10,'a'),after:file(11,'b')},{path:'设计/客户交付/方案.pdf',action:'update',target:1,before:file(2048,'a'),after:file(2145178,'b')},{path:'品牌/导出/logo.svg',action:'create',target:1,before:null,after:file(48120,'c')},{path:'src/theme.ts',action:'update',target:0,before:file(42,'b'),after:file(3920,'a')},{path:'资料/参考/cover.png',action:'create',target:1,before:null,after:file(381238,'b')},{path:'存档/notes/new.md',action:'create',target:0,before:null,after:file(152,'a')},{path:'old.txt',action:'delete',target:1,before:file(20,'b'),after:null}]},conflicts:[{path:'notes/draft.md',versions:{[local]:file(10,'a'),[remote]:file(11,'b')},fingerprint:'fixture-conflict',resolvable:true}],resolutions:[],review_notes:[]};
if(scenario==='scan-error')plan.comparison.issues=['无法读取目录 资料/未授权目录：Permission denied (os error 13)'];
if(scenario==='policy-incoming'||scenario==='policy-outgoing'){
  const next:TaskPolicy={...structuredClone(policy),revision:2,direction:{mode:'one_way_update',source_device:remote}};
  snapshot.policy_states[0].state.pending={proposal:{id:'fixture-pending',expected_revision:1,next,proposed_by:scenario==='policy-incoming'?remote:local},accepted:false};
}
function visiblePlan():Plan {
  const current=snapshot.policy_states[0].state.current;
  if(plan.undo_of||current.direction.mode==='bidirectional')return plan;
  const sourceIsLocal=current.direction.source_device===local;
  const changes:Plan['comparison']['changes']=[];
  for(const change of plan.comparison.changes){
    const conflict=plan.conflicts.find(c=>c.path===change.path);
    const here=conflict?conflict.versions[local]??null:change.target===0?change.before:change.after;
    const there=conflict?conflict.versions[remote]??null:change.target===1?change.before:change.after;
    const source=sourceIsLocal?here:there,target=sourceIsLocal?there:here;
    if(JSON.stringify(source)===JSON.stringify(target)||(!source&&current.direction.mode==='one_way_update'))continue;
    changes.push({...change,target:sourceIsLocal?1:0,before:target,after:source,action:source?target?'update':'create':'delete'});
  }
  return {...plan,resolutions:[],comparison:{...plan.comparison,changes}};
}
let sequence=0;let nextOutcome='completed';const delays=new Map<string,number>();let usage:UsageReport={enabled:true,records:[]};let settings:Settings={days:30,quota:1e10,location:'/fixture/backups',autostart:false,updates_available:false};let fail='';
const calls:{name:string;args?:Record<string,unknown>}[]=[];
const originals=new Map<string,Plan>();
const transport:Transport=async<T,>(name:string,args?:Record<string,unknown>)=>{
  calls.push({name,args:structuredClone(args)});
  const delay=delays.get(name);if(delay){delays.delete(name);await new Promise(resolve=>setTimeout(resolve,delay));}
  if(fail===name){fail='';throw new Error('Fixture rejected operation');}
  const a=args??{};let output:unknown;
  switch(name){
    case 'snapshot':output=snapshot;break;
    case 'usage_report':output=usage;break;
    case 'settings':output=settings;break;
    case 'save_settings':settings={...settings,days:Number(a.days),quota:Number(a.quota),autostart:Boolean(a.autostart)};output=settings;break;
    case 'set_usage_enabled':usage.enabled=Boolean(a.enabled);break;
    case 'clear_usage':usage.records=[];break;
    case 'inspect_task':{
      if(scenario==='scan-progress'){
        for(let tick=0;tick<20;tick++){
          const progress={phase:tick<4?'discovering' as const:'hashing' as const,current_path:`资料/项目 ${Math.floor(tick/3)+1}/报告-${tick+1}.pdf`,directories:Math.min(320,80*(tick+1)),files_total:tick<4?400*(tick+1):1600,files_hashed:Math.max(0,(tick-4)*100),bytes_hashed:Math.max(0,(tick-4)*17400000)};
          snapshot.scan={task:taskId,local:progress,remote:{...progress,files_hashed:Math.max(0,progress.files_hashed-50),current_path:`共享资料/归档/文档-${tick+1}.docx`},incoming:false};
          await new Promise(resolve=>setTimeout(resolve,600));
        }
        snapshot.scan=null;
      }
      output=visiblePlan();break;
    }
    case 'preview_conflict':output={path:a.path,versions:[{device:local,entry:file(10,'a'),text:'title\nlocal change\nend',reason:null},{device:remote,entry:file(11,'b'),text:'title\nremote change\nend',reason:null}]};break;
    case 'resolve_plan': {
      const decisions=a.decisions as {path:string;decision:{choice:string;source_device?:string}}[];
      for(const request of decisions){const conflict=plan.conflicts.find(v=>v.path===request.path)!;plan.review_notes=plan.review_notes.filter(n=>n.path!==request.path);plan.resolutions=plan.resolutions.filter(n=>n.conflict.path!==request.path);
        if(request.decision.choice==='use'){const source=request.decision.source_device!;const target=source===local?remote:local;plan.comparison.changes=plan.comparison.changes.map(ch=>ch.path===request.path?{...ch,action:'update',before:conflict.versions[target]??null,after:conflict.versions[source]??null,target:source===local?1:0}:ch);plan.resolutions.push({conflict,source_device:source});}
        else{plan.review_notes.push({task:taskId,path:request.path,fingerprint:conflict.fingerprint,ignored:request.decision.choice==='ignore_version'});if(request.decision.choice==='ignore_version')plan.comparison.changes=plan.comparison.changes.filter(ch=>ch.path!==request.path);}
      }
      sequence++;plan={...plan,id:`fixture-plan-${sequence}`,digest:`fixture-digest-${sequence}`};output=visiblePlan();break;
    }
    case 'review_notes':output=plan.review_notes;break;
    case 'clear_review_note':plan.review_notes=plan.review_notes.filter(n=>n.path!==a.path);break;
    case 'preview_execution': {const selected=a.selected as string[];const changes=visiblePlan().comparison.changes;const risks=[local,remote].map((device,target)=>{const planned=changes.filter(ch=>ch.action==='delete'&&ch.target===target);const chosen=planned.filter(ch=>selected.includes(ch.path));return {device,planned_deletions:planned.length,selected_deletions:chosen.length,recent_deletions:planned.length?99:0,baseline_files:100,reasons:chosen.length?['large_deletion']:[]};});output={plan:plan.id,digest:plan.digest,selection_digest:'selection-'+selected.join(','),selected,approval_required:risks.some(r=>r.selected_deletions>0),risks};break;}
    case 'execute_plan': {if(a.plan!==plan.id||a.digest!==plan.digest)throw new Error('Fixture stale plan');const selected=a.selected as string[];if(visiblePlan().comparison.changes.some(ch=>ch.action==='delete'&&selected.includes(ch.path))&&!a.approveRisk)throw new Error('Fixture deletion approval missing');const requested=visiblePlan().comparison.changes.filter(ch=>selected.includes(ch.path));const outcome=nextOutcome;nextOutcome='completed';const changes=outcome==='partial'?requested.slice(0,Math.max(1,Math.floor(requested.length/2))):outcome==='failed'?[]:requested;const applied=new Set(changes.map(ch=>ch.path));const batch:Batch={id:`fixture-batch-${++sequence}`,task:taskId,label:snapshot.tasks[0].label,created:Math.floor(Date.now()/1000),status:outcome,undo_of:plan.undo_of,done:changes.length,total:requested.length,skipped:visiblePlan().comparison.changes.length-changes.length,message:outcome==='partial'?'Fixture connection interrupted':null,undo_available:!plan.undo_of&&changes.length>0};originals.set(batch.id,{...structuredClone(plan),comparison:{...structuredClone(plan.comparison),changes:structuredClone(changes)}});snapshot.history.unshift(batch);plan.comparison.changes=plan.comparison.changes.filter(ch=>!applied.has(ch.path));if(usage.enabled&&!batch.undo_of&&outcome==='completed')usage.records.push({id:batch.id,created:batch.created,files:changes.length,bytes:String(changes.reduce((sum,ch)=>sum+(ch.after?.type==='file'?ch.after.bytes:0),0))});output=batch;break;}
    case 'inspect_undo': {const old=originals.get(String(a.batch));if(!old)throw new Error('Fixture no history');plan={...structuredClone(old),id:`fixture-undo-${++sequence}`,digest:`fixture-undo-${sequence}`,undo_of:String(a.batch),conflicts:[],resolutions:[]};plan.comparison.changes=plan.comparison.changes.filter(ch=>ch.action!=='conflict').map(ch=>({...ch,before:ch.after,after:ch.before,action:ch.before?'update':'delete'}));output=visiblePlan();break;}
    case 'pause_task':snapshot.policy_states[0].paused=Boolean(a.paused);break;
    case 'pause_all':snapshot.paused_all=Boolean(a.paused);break;
    case 'task_policy':output=snapshot.policy_states[0];break;
    case 'propose_task_policy': {if(a.expectedRevision!==snapshot.policy_states[0].state.current.revision||snapshot.policy_states[0].state.pending)throw new Error('Fixture stale policy');if(!snapshot.peers[0].online)throw new Error('Fixture peer offline');const next=a.next as TaskPolicy;const current=snapshot.policy_states[0].state.current;if(current.trust.kind==='shared'&&current.trust.owner_device!==local)throw new Error('Fixture owner-only policy');if(current.trust.kind==='unclassified'||JSON.stringify(current.trust)!==JSON.stringify(next.trust)){snapshot.policy_states[0].state.pending={proposal:{id:`fixture-proposal-${++sequence}`,expected_revision:current.revision,next,proposed_by:local},accepted:false};output=snapshot.policy_states[0].state;break;}snapshot.policy_states[0].state.current=next;plan.policy.revision=next.revision;plan.policy.digest=`policy-fixture-${next.revision}`;sequence++;plan.id=`fixture-plan-${sequence}`;plan.digest=`fixture-digest-${sequence}`;output=snapshot.policy_states[0].state;break;}
    case 'reconcile_task_policy':output=snapshot.policy_states[0].state;break;
    case 'answer_task_policy':{
      const state=snapshot.policy_states[0].state;
      if(!state.pending||state.pending.proposal.id!==a.proposal)throw new Error('Fixture stale proposal');
      if(a.accept){state.current=state.pending.proposal.next;plan.policy={revision:state.current.revision,digest:'fixture-policy-updated'};}
      state.pending=null;output=state;break;
    }
    case 'forget_peer':snapshot.peers=snapshot.peers.filter(peer=>peer.id!==a.peer);snapshot.tasks=snapshot.tasks.filter(task=>task.peer!==a.peer);snapshot.policy_states=snapshot.policy_states.filter(view=>snapshot.tasks.some(task=>task.id===view.task));break;
    case 'folders':output={local:[{id:'local-grant',label:'Local',path:'/fixture/local'}],remote:[{id:'remote-grant',label:'Remote',path:'D:\\fixture'}]};break;
    case 'local_folders':output=[{id:'local-grant',label:'Local',path:'/fixture/local'}];break;
    case 'grant_folder':output={id:'extra-grant',label:'Extra',path:'/fixture/new'};break;
    case 'create_task':output=snapshot.tasks[0];break;
    case 'invite':output={code:'01234',expires_at:Math.floor(Date.now()/1000)+60};break;
    case 'pair':case 'answer_pair':case 'cancel_batch':case 'revoke_folder':break;
    case 'check_permissions':output={platform:'macos',port:47657,addresses:['127.0.0.1:47657'],listener_error:null,firewall:null};break;
    case 'open_permission_settings':case 'allow_private_lan':break;
    case 'test_peer_address':output='Fixture listener reachable';break;
    default:throw new Error(`Unsupported fixture command: ${name}`);
  }
  return structuredClone(output) as T;
};
Object.assign(window,{__SYNCFU_TEST__:{calls,snapshot,failNext:(name:string)=>{fail=name;},delayNext:(name:string,ms:number)=>{delays.set(name,ms);},outcomeNext:(status:'completed'|'partial'|'failed')=>{nextOutcome=status;},replaceChanges:(changes:Plan['comparison']['changes'])=>{sequence++;plan={...plan,id:`fixture-plan-${sequence}`,digest:`fixture-digest-${sequence}`,undo_of:null,resolutions:[],conflicts:[],review_notes:[],comparison:{same:0,total:changes.length,ignored:0,issues:[],changes:structuredClone(changes)}};}}});
export default function DesktopHarness(){return <Desktop transport={transport} testMode/>;}
