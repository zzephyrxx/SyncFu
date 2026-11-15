import {useId,useLayoutEffect,useRef,type KeyboardEvent} from 'react';

const LENGTH=5;
export function PairingCodeInput({digits,onChange,label,description,disabled=false}:{digits:string[];onChange:(digits:string[])=>void;label:string;description:string;disabled?:boolean}){
  const id=useId();
  const fields=useRef<(HTMLInputElement|null)[]>([]);
  const pendingFocus=useRef<number|null>(null);
  const focus=(index:number)=>{const field=fields.current[Math.max(0,Math.min(LENGTH-1,index))];field?.focus();field?.select();};
  useLayoutEffect(()=>{if(pendingFocus.current!==null){focus(pendingFocus.current);pendingFocus.current=null;}},[digits]);
  const commit=(next:string[],index:number)=>{pendingFocus.current=index;onChange(next);};
  const update=(index:number,text:string)=>{
    const clean=text.normalize('NFKC').replace(/\D/g,'').slice(0,LENGTH);
    if(!clean){commit(digits.map((digit,i)=>i===index?'':digit),index);return;}
    const start=clean.length===LENGTH?0:index;
    const next=[...digits];
    [...clean].forEach((digit,offset)=>{if(start+offset<LENGTH)next[start+offset]=digit;});
    commit(next,start+clean.length);
  };
  const navigate=(event:KeyboardEvent<HTMLInputElement>,index:number)=>{
    if(event.key==='Backspace'){
      event.preventDefault();const at=digits[index]?index:Math.max(0,index-1);
      commit(digits.map((digit,i)=>i===at?'':digit),at);
    }else if(event.key==='Delete'){
      event.preventDefault();commit(digits.map((digit,i)=>i===index?'':digit),index);
    }else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();focus(event.key==='Home'?0:event.key==='End'?LENGTH-1:index+(event.key==='ArrowLeft'?-1:1));
    }
  };
  return <fieldset className="sf-pair-code" data-slot="input-otp" disabled={disabled} aria-describedby={`${id}-help`}>
    <legend>{label}</legend>
    <p id={`${id}-help`}>{description}</p>
    <div className="sf-pair-code-fields" data-slot="input-otp-group">
      {Array.from({length:LENGTH},(_,index)=><input key={index} ref={element=>{fields.current[index]=element;}} data-slot="input-otp-slot" data-filled={Boolean(digits[index])} type="text" inputMode="numeric" autoComplete={index===0?'one-time-code':'off'} autoCapitalize="off" spellCheck={false} name={`pairing-code-${index+1}`} aria-label={`${label} ${index+1} / ${LENGTH}`} value={digits[index]??''} maxLength={LENGTH} pattern="[0-9]" required onFocus={event=>event.currentTarget.select()} onClick={event=>event.currentTarget.select()} onChange={event=>update(index,event.target.value)} onKeyDown={event=>navigate(event,index)} onPaste={event=>{event.preventDefault();update(index,event.clipboardData.getData('text'));}}/>) }
    </div>
  </fieldset>;
}
