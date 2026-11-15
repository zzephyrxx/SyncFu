import {useEffect,useState} from 'react';
import {deviceProfileKey,readDeviceProfiles,saveDeviceProfile,type DeviceProfile,type DeviceProfiles} from './device-metadata';

const profileEvent='syncfu:device-profiles-changed';
function read(){
  try{return readDeviceProfiles(window.localStorage);}
  catch{return {profiles:Object.create(null) as DeviceProfiles,failed:true};}
}
export function useDeviceProfiles(){
  const [state,setState]=useState(read);
  useEffect(()=>{
    const changed=()=>setState(read());
    const external=(event:StorageEvent)=>{if(event.key===deviceProfileKey||event.key===null)changed();};
    window.addEventListener(profileEvent,changed);window.addEventListener('storage',external);
    return()=>{window.removeEventListener(profileEvent,changed);window.removeEventListener('storage',external);};
  },[]);
  const saveProfile=(id:string,profile:DeviceProfile)=>{
    try{
      const next=saveDeviceProfile(window.localStorage,id,profile);setState(next);
      if(!next.failed)window.dispatchEvent(new Event(profileEvent));
      return !next.failed;
    }catch{setState(old=>({...old,failed:true}));return false;}
  };
  return {profiles:state.profiles,storageFailed:state.failed,saveProfile};
}
