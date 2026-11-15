import {useState} from 'react';
import './device-avatar.css';

// Unmodified Microsoft Fluent Emoji 3D assets, MIT. URLs, hashes and license:
// assets/fluent-emoji/sources.json and assets/fluent-emoji/LICENSE.txt.
const artwork:Record<string,string>={
  '💻':new URL('../../assets/fluent-emoji/laptop_3d.png',import.meta.url).href,
  '🖥️':new URL('../../assets/fluent-emoji/desktop_computer_3d.png',import.meta.url).href,
  '📱':new URL('../../assets/fluent-emoji/mobile_phone_3d.png',import.meta.url).href,
  '🐱':new URL('../../assets/fluent-emoji/cat_face_3d.png',import.meta.url).href,
  '🐼':new URL('../../assets/fluent-emoji/panda_3d.png',import.meta.url).href,
  '🚀':new URL('../../assets/fluent-emoji/rocket_3d.png',import.meta.url).href,
  '🌱':new URL('../../assets/fluent-emoji/seedling_3d.png',import.meta.url).href,
  '🎨':new URL('../../assets/fluent-emoji/artist_palette_3d.png',import.meta.url).href,
  '📚':new URL('../../assets/fluent-emoji/books_3d.png',import.meta.url).href,
  '🎮':new URL('../../assets/fluent-emoji/video_game_3d.png',import.meta.url).href,
};
export const fluentEmojiChoices=['🐱','🐼','🚀','🌱','🎨','📚','🎮','💻','🖥️','📱'] as const;
export function FluentEmoji({emoji,className=''}:{emoji:string;className?:string}){
  const [failed,setFailed]=useState('');
  const source=artwork[emoji]??artwork[`${emoji}\uFE0F`];
  return <span className={`sf-fluent-emoji ${className}`} aria-hidden="true">{source&&failed!==emoji?<img src={source} alt="" draggable={false} onError={()=>setFailed(emoji)}/>:emoji}</span>;
}
