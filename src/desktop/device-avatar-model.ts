const defaults=['🐱','🐼','🚀','🌱','🎨','📚','🎮'] as const;
export function defaultDeviceEmoji(id:string):string{
  let hash=2166136261;
  for(const character of id){hash^=character.codePointAt(0)??0;hash=Math.imul(hash,16777619);}
  return defaults[(hash>>>0)%defaults.length];
}
export function deviceAvatarTone(id:string):number{
  let hash=0;for(const character of id)hash=(Math.imul(hash,31)+(character.codePointAt(0)??0))|0;
  return (hash>>>0)%5;
}
