import {createContext,useContext,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {command,desktop} from '../../api';
import {usePrototype} from '../../prototype/context';
import {getGlassOpticalMap} from './optics';
import {captureGlassWithinDeadline} from './capture-lifecycle';

type Backdrop={data_url:string;width:number;height:number;viewportWidth:number;viewportHeight:number;dark:boolean;level:'soft'|'clear'};
const EnabledContext=createContext(false);
const ThemeContext=createContext(false);
const LevelContext=createContext<'soft'|'clear'>('soft');
const BackdropContext=createContext<Backdrop|null>(null);
const accessibilityQuery='(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)';

export function GlassProvider({children}:{children:ReactNode}){
  const {prefs,dark}=usePrototype();
  const [reduced,setReduced]=useState(()=>matchMedia(accessibilityQuery).matches);
  useEffect(()=>{const media=matchMedia(accessibilityQuery);const update=()=>setReduced(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  return <EnabledContext.Provider value={prefs.material==='glass'&&!reduced}><ThemeContext.Provider value={dark}><LevelContext.Provider value={prefs.glassLevel}>{children}</LevelContext.Provider></ThemeContext.Provider></EnabledContext.Provider>;
}

// Capture only this application's WebView before the floating surface exists.
// This supplies real image pixels to ordinary SVG filters on both WKWebView
// and WebView2; neither engine needs SVG backdrop-filter support. The center
// still uses a live CSS backdrop. No screenshot leaves memory or the app.
async function captureBackdrop(dark:boolean,level:'soft'|'clear'):Promise<Backdrop|null>{
  if(!desktop)return null;
  const viewportWidth=innerWidth,viewportHeight=innerHeight;
  const appearance=document.documentElement.dataset.theme;
  const glassLevel=document.documentElement.dataset.glassLevel;
  try{
    const image=await command<{data_url:string;width:number;height:number}>('capture_glass_backdrop');
    if(document.documentElement.dataset.theme!==appearance||document.documentElement.dataset.glassLevel!==glassLevel||innerWidth!==viewportWidth||innerHeight!==viewportHeight||!image.data_url.startsWith('data:image/png;base64,'))return null;
    return {...image,viewportWidth,viewportHeight,dark,level};
  }catch{return null;}
}

export function useGlassOpen(open:boolean|undefined,defaultOpen:boolean|undefined,onOpenChange:((open:boolean)=>void)|undefined){
  const enabled=useContext(EnabledContext)&&desktop;
  const dark=useContext(ThemeContext);
  const level=useContext(LevelContext);
  const [local,setLocal]=useState(defaultOpen??false);
  const requested=open??local;
  const [ready,setReady]=useState(false);
  const [snapshot,setSnapshot]=useState<Backdrop|null>(null);
  const generation=useRef(0);
  useEffect(()=>{
    const serial=++generation.current;
    if(!requested||!enabled){setReady(false);setSnapshot(null);return;}
    const controller=new AbortController();
    const frame=requestAnimationFrame(()=>{
      void captureGlassWithinDeadline(()=>captureBackdrop(dark,level),{
        timeoutMs:240,signal:controller.signal,isCurrent:()=>generation.current===serial,
      }).then(outcome=>{
        if(outcome.status==='cancelled'||generation.current!==serial)return;
        ++generation.current;
        setSnapshot(outcome.status==='captured'?outcome.value:null);setReady(true);
      });
    });
    return()=>{++generation.current;cancelAnimationFrame(frame);controller.abort();};
  },[requested,enabled]);
  const change=(next:boolean)=>{
    if(!next){++generation.current;setReady(false);setSnapshot(null);}
    setLocal(next);onOpenChange?.(next);
  };
  return {open:requested&&(!enabled||ready),onOpenChange:change,snapshot};
}
export function GlassBackdropProvider({snapshot,children}:{snapshot:Backdrop|null;children:ReactNode}){
  return <BackdropContext.Provider value={snapshot}>{children}</BackdropContext.Provider>;
}

type SurfaceRect={x:number;y:number;width:number;height:number;radius:number};
// A pointer-free rim, clipped out of the content area. Resize/scroll invalidates
// the old viewport capture instead of stretching stale pixels into the surface.
export function GlassRim(){
  const enabled=useContext(EnabledContext);
  const snapshot=useContext(BackdropContext);
  const dark=useContext(ThemeContext);
  const level=useContext(LevelContext);
  const layer=useRef<HTMLSpanElement>(null);
  const [rect,setRect]=useState<SurfaceRect|null>(null);
  const [invalid,setInvalid]=useState(false);
  const id=useId().replaceAll(':','');
  useLayoutEffect(()=>{
    if(!enabled||!snapshot||!layer.current)return;
    setInvalid(false);
    const host=layer.current.parentElement!;
    let frame=0;
    const measure=()=>{
      const r=host.getBoundingClientRect();
      setRect({x:r.x+host.clientLeft,y:r.y+host.clientTop,width:host.clientWidth,height:host.clientHeight,radius:Math.max(0,parseFloat(getComputedStyle(host).borderTopLeftRadius)-host.clientLeft)});
    };
    measure();frame=requestAnimationFrame(measure);
    const observer=new ResizeObserver(measure);observer.observe(host);
    const invalidate=()=>setInvalid(true);
    window.addEventListener('resize',invalidate);
    // Scroll inside a popup changes its foreground only. Page scrolling or a
    // scrolling underlying dialog invalidates a nested menu's capture.
    const scroll=(event:Event)=>{if(event.target instanceof Node&&!host.contains(event.target))invalidate();};
    document.addEventListener('scroll',scroll,true);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',invalidate);document.removeEventListener('scroll',scroll,true);};
  },[enabled,snapshot]);
  if(!enabled||!snapshot)return null;
  const visible=rect&&!invalid&&snapshot.dark===dark&&snapshot.level===level&&innerWidth===snapshot.viewportWidth&&innerHeight===snapshot.viewportHeight;
  const map=visible?getGlassOpticalMap(rect.width,rect.height,rect.radius,Math.min(level==='soft'?12:16,Math.min(rect.width,rect.height)*.2)):null;
  return <span ref={layer} className="sf-glass-optics" aria-hidden="true" data-optics={visible?'refracted':'inactive'}>
    {visible&&map&&<svg width="100%" height="100%" viewBox={`0 0 ${rect.width} ${rect.height}`} focusable="false" overflow="hidden">
      <defs>
        <clipPath id={`${id}-clip`}><rect width={rect.width} height={rect.height} rx={rect.radius}/></clipPath>
        <filter id={`${id}-bend`} x="0" y="0" width={rect.width} height={rect.height} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feImage href={map.url} x="0" y="0" width={rect.width} height={rect.height} preserveAspectRatio="none" result="fieldBytes"/>
          <feComponentTransfer in="fieldBytes" result="field"><feFuncR type="linear" slope={255/254} intercept={-1/254}/><feFuncG type="linear" slope={255/254} intercept={-1/254}/></feComponentTransfer>
          <feDisplacementMap in="SourceGraphic" in2="field" scale={map.scale*(level==='soft'?.4:1)} xChannelSelector="R" yChannelSelector="G" result="bent"/>
          <feGaussianBlur in="bent" stdDeviation="0.35" result="softEdge"/>
          <feColorMatrix in="fieldBytes" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0" result="rimMask"/>
          <feComposite in="softEdge" in2="rimMask" operator="in"/>
        </filter>
      </defs>
      <g clipPath={`url(#${id}-clip)`}><g filter={`url(#${id}-bend)`}><image href={snapshot.data_url} x={-rect.x} y={-rect.y} width={snapshot.viewportWidth} height={snapshot.viewportHeight} preserveAspectRatio="none"/></g></g>
    </svg>}
  </span>;
}

// Used by the development optical scene; not rendered in the production UI.
export function useGlassSnapshotAvailable(){return useContext(BackdropContext)!==null;}
