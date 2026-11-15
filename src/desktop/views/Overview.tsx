import {useMemo,useState,type ReactElement} from 'react';
import {BarChart3,Grid2X2} from '../ui/glyphs';
import {usePrototype} from '../../prototype/context';
import {summariseUsage,usageScale,type UsageEvent} from '../../prototype/usage';
import type {Locale} from '../../prototype/messages';
import {Tooltip,TooltipTrigger,TooltipContent} from '../../components/ui/tooltip';
import {Art,Button,Help,Panel} from '../ui/UI';
import './overview.css';

const copy:Record<Locale,{heatmap:string;dailyFiles:string;less:string;more:string;views:string}>={
  'zh-CN':{heatmap:'热力图',dailyFiles:'每日处理文件',less:'少',more:'多',views:'统计视图'},
  'zh-TW':{heatmap:'熱力圖',dailyFiles:'每日處理檔案',less:'少',more:'多',views:'統計檢視'},
  en:{heatmap:'Heatmap',dailyFiles:'Files processed each day',less:'Less',more:'More',views:'Statistics view'},
  ja:{heatmap:'ヒートマップ',dailyFiles:'1日ごとの処理ファイル数',less:'少',more:'多',views:'統計表示'},
  ko:{heatmap:'히트맵',dailyFiles:'일별 처리한 파일',less:'적음',more:'많음',views:'통계 보기'},
};
type UsageRow=ReturnType<typeof summariseUsage>['rows'][number];

function DayTooltip({row,children}:{row:UsageRow;children:ReactElement}){
  const {t,date,number,bytes}=usePrototype();
  return <Tooltip delayDuration={100}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="top" sideOffset={8} collisionPadding={16} className="bui-tooltip sfu-tooltip sf-usage-tooltip">
      <strong>{date(row.timestamp,{year:'numeric',month:'short',day:'numeric'})}</strong>
      <dl><div><dt>{t('fileCount')}</dt><dd>{number(row.files)}</dd></div><div><dt>{t('transferBytes')}</dt><dd>{bytes(row.bytes)}</dd></div><div><dt>{t('syncCount')}</dt><dd>{number(row.syncs)}</dd></div></dl>
    </TooltipContent>
  </Tooltip>;
}

// Both views use the same completed, real sync records and selected date range.
export function OverviewPage({events,enabled,onSettings}:{events:UsageEvent[];enabled:boolean;onSettings:()=>void}){
  const {t,bytes,number,date,prefs}=usePrototype();
  const labels=copy[prefs.locale];
  const [range,setRange]=useState<7|30>(7);
  const [view,setView]=useState<'chart'|'heatmap'>('chart');
  const report=useMemo(()=>summariseUsage(events,range),[events,range]);
  const maximum=usageScale(report.rows.map(row=>row.bytes));
  const mostFiles=Math.max(1,...report.rows.map(row=>row.files));
  const firstDate=new Date(report.rows[0].timestamp);
  const leadingDays=(firstDate.getDay()+6)%7;
  const weekdays=Array.from({length:7},(_,index)=>{
    const day=new Date(firstDate);day.setDate(day.getDate()-leadingDays+index);
    return date(day.getTime(),{weekday:'short'});
  });
  const title=view==='heatmap'?labels.dailyFiles:t('dailyBytes');
  const dayLabel=(row:UsageRow)=>`${date(row.timestamp)}: ${t('fileCount')} ${number(row.files)}, ${t('transferBytes')} ${bytes(row.bytes)}, ${t('syncCount')} ${number(row.syncs)}`;

  return <section className="sf-page sf-overview-page"><header className="ui-page-heading"><h1>{t('overview')}</h1><span className="ui-chip">{t('realStats')}</span></header>
    {!enabled?<div className="ui-centered"><Art kind="shield" size="large"/><h2>{t('statsOff')}</h2><Button onClick={onSettings}>{t('openSettings')}</Button></div>:<>
      <div className="ui-overview-filter"><div className="ui-segment" role="group" aria-label={t('dateLabel')}>{([7,30]as const).map(days=><button type="button" key={days} aria-pressed={range===days} className={range===days?'active':''} onClick={()=>setRange(days)}>{t(days===7?'week':'month')}</button>)}</div><span>{date(report.rows[0].timestamp)} — {date(report.rows.at(-1)!.timestamp)}</span></div>
      <dl className="ui-metrics"><div><dt>{t('transferBytes')}</dt><dd>{bytes(report.bytes)}</dd></div><div><dt>{t('syncCount')}</dt><dd>{number(report.syncs)}</dd></div><div><dt>{t('fileCount')}</dt><dd>{number(report.files)}</dd></div></dl>
      <Panel title={title} className="sf-usage-panel" actions={<div className="ui-segment sf-usage-views" role="group" aria-label={labels.views}><button type="button" aria-pressed={view==='chart'} className={view==='chart'?'active':''} onClick={()=>setView('chart')}><BarChart3 size={15}/>{t('chart')}</button><button type="button" aria-pressed={view==='heatmap'} className={view==='heatmap'?'active':''} onClick={()=>setView('heatmap')}><Grid2X2 size={15}/>{labels.heatmap}</button></div>}>
        {!report.syncs?<div className="ui-centered compact"><Art kind="folder"/><h2>{t('noStats')}</h2></div>:view==='heatmap'?<div className="sf-usage-heatmap" role="group" aria-label={labels.dailyFiles}>
          <div className="sf-heatmap-weekdays" aria-hidden="true">{weekdays.map((weekday,index)=><span key={index}>{weekday}</span>)}</div>
          <div className="sf-heatmap-days">
            {Array.from({length:leadingDays},(_,index)=><span key={`empty-${index}`} className="sf-heatmap-blank" aria-hidden="true"/>)}
            {report.rows.map(row=><DayTooltip key={row.key} row={row}><button type="button" className="sf-heatmap-day" data-level={row.files===0?0:Math.max(1,Math.ceil(row.files/mostFiles*4))} aria-label={dayLabel(row)}><span className="sf-heatmap-date">{date(row.timestamp,{day:'numeric'})}</span><strong>{number(row.files)}</strong></button></DayTooltip>)}
          </div>
          <div className="sf-heatmap-legend"><span>{t('fileCount')}</span><span>{labels.less}</span><span className="sf-heatmap-swatches" aria-hidden="true">{[0,1,2,3,4].map(level=><i key={level} data-level={level}/>)}</span><span>{labels.more}</span></div>
        </div>:<div className="ui-chart-frame" role="group" aria-label={t('dailyBytes')}><div className="ui-chart-ticks">{[maximum,maximum/2,0].map(value=><span key={value}>{bytes(value)}</span>)}</div><div className="ui-chart-scroll"><div className="ui-chart" style={{minWidth:range*28}}><div className="ui-chart-grid" aria-hidden="true"><i/><i/><i/></div><div className="ui-chart-columns">{report.rows.map(row=><DayTooltip key={row.key} row={row}><button type="button" className="ui-bar-hit" aria-label={dayLabel(row)}><span className="ui-bar" style={{height:`${row.bytes/maximum*100}%`}}/></button></DayTooltip>)}</div><div className="ui-chart-dates">{report.rows.map((row,index)=><span key={row.key}>{range===7||index%5===0||index===range-1?date(row.timestamp,{month:'numeric',day:'numeric'}):''}</span>)}</div></div></div></div>}
      </Panel><Help>{t('usageHelp')}</Help><p className="ui-body-copy">{t('statsSince')}</p>
    </>}
  </section>;
}
