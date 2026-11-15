import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.');
mkdirSync(join(root,'artifacts'),{recursive:true});
const destination=mkdtempSync(join(root,'artifacts/boardui-sources-'));
const repo='BoardUI/boardui',commit='ec5c5eb3e29c2441be63b9422cd54f411ef23466';
const files=['LICENSE','app/globals.css','components/application/app-shell/app-shell.tsx','components/application/data-table/data-table.tsx','components/base/buttons/button.tsx','components/base/buttons/icon-button.tsx','components/base/buttons/button-group.tsx','components/base/checkbox/checkbox.tsx','components/base/checkbox/checkbox-card.tsx','components/base/checkbox/checkbox-glyph.tsx','components/base/table/table.tsx','components/base/segmented-control/segmented-control.tsx','components/base/dropdown/dropdown.tsx','components/base/tooltip/tooltip.tsx','components/base/pagination/pagination.tsx'];
const entries=[];const missing=[];
for(const file of files){const url=`https://raw.githubusercontent.com/${repo}/${commit}/${file}`;const response=await fetch(url);if(!response.ok){missing.push({file,status:response.status});continue;}const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>1024*1024)throw Error('Unexpected source size');const path=join(destination,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});entries.push({repo,commit,file,url,license:'MIT',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}
writeFileSync(join(destination,'sources.json'),JSON.stringify({entries,missing},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({destination,files:entries.length,missing},null,2));
