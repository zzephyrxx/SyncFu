import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';
import {collectSources,createManifest,hash,validSourcePath,verifySources} from './release-source.mjs';

const crcTable=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

// Standard ZIP/DEFLATE, UTF-8 names, fixed timestamps. No platform tools or dependencies.
export function zipSources(entries){
  if(entries.length>65535)throw new Error('Too many source files for this ZIP format.');
  const files=[],directory=[];let offset=0;
  for(const {name,bytes} of entries){
    if(!validSourcePath(name))throw new Error(`Unsafe ZIP path: ${name}`);
    const filename=Buffer.from(name,'utf8'),compressed=deflateRawSync(bytes,{level:9});
    if(filename.length>65535||bytes.length>0xffffffff||compressed.length>0xffffffff)throw new Error(`Source file exceeds ZIP limits: ${name}`);
    const checksum=crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);
    local.writeUInt32LE(checksum,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);
    central.writeUInt32LE(checksum,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    files.push(local,filename,compressed);directory.push(central,filename);offset+=local.length+filename.length+compressed.length;
    if(offset>0xffffffff)throw new Error('Source archive exceeds the ZIP size limit.');
  }
  const index=Buffer.concat(directory),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,index,end]);
}

export function packageSource(root){
  verifySources(root); // A source ZIP must remain intact when repackaged.
  const entries=collectSources(root),manifest=createManifest(root,entries),folder=`SyncFu-${manifest.version}`;
  const archive=zipSources([...entries,{name:'source-manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')}].map(entry=>({...entry,name:`${folder}/${entry.name}`})));
  const outputDirectory=join(root,'releases',manifest.version),filename=`SyncFu-${manifest.version}-windows-source.zip`;
  mkdirSync(outputDirectory,{recursive:true});
  const output=join(outputDirectory,filename);writeFileSync(output,archive);
  writeFileSync(`${output}.sha256`,`${hash(archive)}  ${filename}\n`);
  return {output,sourceId:manifest.sourceId,fileCount:entries.length,size:archive.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length>2)throw new Error('Usage: node scripts/package-source.mjs');
    const result=packageSource(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
    console.log(`Packaged ${result.fileCount} source files (${result.size} bytes).\nSource ID: ${result.sourceId}\n${result.output}`);
    console.log('Dependencies are not bundled. Building requires internet access, Node.js, Rust and the platform build tools.');
  }catch(error){console.error(`SOURCE PACKAGE FAILED: ${error.message}`);process.exitCode=1;}
}
