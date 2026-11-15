"use client";
// Adapted from EasyUI MacOSFolderCards.tsx, MIT © 2026 Suraj Maurya.
// Retains the back shell, tab, three emerging sheets and hinged front flap.
// Removed demo contents; native button + real onOpen avoids inert expandable cards.
import {useState,type CSSProperties} from 'react';
import {motion} from 'motion/react';
import {ArrowUpRight,FileText,Folder} from 'lucide-react';
import {usePrototype} from '../../prototype/context';
import {useMotionAllowed,springs,motionTokens} from '../../prototype/motion';
export function FolderArtwork({peek=false,documents=[],tone=0}:{peek?:boolean;documents?:string[];tone?:number}){
  const allowed=useMotionAllowed();const {prefs}=usePrototype();const moving=peek&&allowed;
  if(!prefs.illustrations)return <Folder className="material-folder material-folder-flat" data-tone={tone%4} strokeWidth={1.2} aria-hidden="true"/>;
  return <motion.span className="material-folder" data-tone={tone%4} style={{perspective:700}} animate={moving?{y:-motionTokens.distance.xs,scale:1.03}:{y:0,scale:1}} transition={springs.snappy} aria-hidden="true">
    <span className="material-folder-back"><i/></span>
    <span className="material-folder-papers">{[2,1,0].map((depth)=><motion.span key={depth} className={`material-folder-paper paper-${depth}`} initial={false} animate={moving?{y:-(10+depth*7),rotate:depth===2?6:depth===1?-4:0}:{y:0,rotate:allowed?depth===2?2:depth===1?-1.5:0:0}} transition={springs.snappy}><FileText size={15}/>{documents[depth]&&<span>{documents[depth]}</span>}<i/><i/></motion.span>)}</span>
    <motion.span className="material-folder-front" initial={false} animate={moving?{rotateX:-16,y:2}:{rotateX:0,y:0}} transition={springs.snappy} style={{transformOrigin:'bottom center',transformStyle:'preserve-3d'}}><span className="material-folder-glint"/><span className="material-folder-mark"/></motion.span>
  </motion.span>;
}
export function TaskFolder({name,detail,status,onOpen,documents,tone=0,disabled=false}:{name:string;detail:string;status:string;onOpen:()=>void;documents?:string[];tone?:number;disabled?:boolean}){
  const [peek,setPeek]=useState(false);const allowed=useMotionAllowed();
  return <motion.button type="button" className="material-task-folder" onMouseEnter={()=>setPeek(true)} onMouseLeave={()=>setPeek(false)} onFocus={()=>setPeek(true)} onBlur={()=>setPeek(false)} onClick={onOpen} disabled={disabled} whileTap={allowed?{scale:motionTokens.scale.subtle}:undefined} transition={springs.snappy} style={{'--folder-index':tone}as CSSProperties}>
    <span className="material-folder-platform"><FolderArtwork peek={peek} documents={documents} tone={tone}/></span>
    <span className="material-task-folder-label"><strong>{name}</strong><ArrowUpRight size={17}/></span><span className="material-task-folder-detail">{detail}</span><span className="material-task-folder-status">{status}</span>
  </motion.button>;
}
