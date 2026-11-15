import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.');
mkdirSync(join(root,'artifacts'),{recursive:true});
const destination=mkdtempSync(join(root,'artifacts/material-sources-'));
const sources=[
  {repo:'deeplethe/solid-glass',commit:'6e8903e494a15491ceda38fafea5056c95a74d44',license:'MIT',files:['LICENSE','NOTICE.md','src/solid-glass.css','src/blocks/agent-workspace.tsx','src/components/ui/panel.tsx']},
  {repo:'Surajmaurya1/easyui',commit:'f7193ce6f96d38fb39734c0ed8be43567a7eee4a',license:'MIT',files:['LICENSE','src/components/ui/MacOSFolderCards.tsx','src/components/ui/GlassNavbar.tsx','src/components/ui/PressButton.tsx','src/components/ui/LiquidToggle.tsx']},
  {repo:'charles-postiaux/caffeine-day',commit:'38fbdbb11b8e3b9b9e44d157334f30705efbc874',license:'MIT',files:['LICENSE','caffeine.js']},
  {repo:'adamgiebl/neumorphism',commit:'8ab93a6bea6493cc464d45a334b5fb7a90d34308',license:'BSD-3-Clause',files:['LICENSE.md','src/utils.js','src/Configuration.js']},
  {repo:'shadcn-ui/ui',commit:'e62c9435fff729a175f38983dee73b2cb4f6a069',license:'MIT',files:['LICENSE.md','apps/v4/registry/new-york-v4/ui/sheet.tsx']},
];
const entries=[];
for(const source of sources){
  const directory=join(destination,source.repo.replaceAll('/','--'));mkdirSync(directory);
  for(const name of source.files){
    const url=`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${name}`;
    const response=await fetch(url);if(!response.ok)throw Error(`${response.status}: ${url}`);
    const contents=Buffer.from(await response.arrayBuffer());if(contents.length>1024*1024)throw Error('Unexpected source size');
    const path=join(directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,contents,{flag:'wx'});
    entries.push({...source,files:undefined,file:name,url,sha256:createHash('sha256').update(contents).digest('hex'),bytes:contents.length,localSource:path});
  }
}
writeFileSync(join(destination,'sources.json'),JSON.stringify(entries,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({destination,files:entries.length,totalBytes:entries.reduce((n,e)=>n+e.bytes,0)},null,2));
