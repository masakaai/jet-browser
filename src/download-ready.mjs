import {constants} from 'node:fs';
import {lstat,realpath,open} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseDownloadJournal} from './download-journal.mjs';
const limit=1024*1024;

// The root must be the launcher's assigned canonical path, not a client field.
export async function readNativeDownloadJournal(root){
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root)throw Error('Invalid download journal root');
 let directory;
 try{directory=await lstat(root);}catch(error){if(error.code==='ENOENT')return {ready:false,text:''};throw error;}
 if(!directory.isDirectory()||directory.isSymbolicLink()||await realpath(root)!==root)throw Error('Invalid download journal root');
 const path=join(root,'events.tsv');let file;
 try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(error.code==='ENOENT')return {ready:false,text:''};throw error;}
 try{
  const before=await file.stat();
  if(!before.isFile()||before.nlink!==1||before.size>limit)throw Error('Invalid download journal file');
  // Read only the bounded size observed at open. Concurrent appends are picked
  // up next poll; incomplete final lines remain uncommitted by the parser.
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const read=await file.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}
  const after=await file.stat(),current=await lstat(path),currentRoot=await lstat(root);
  if(offset!==before.size||after.size<before.size||after.size>limit||after.nlink!==1||current.isSymbolicLink()||current.dev!==after.dev||current.ino!==after.ino||currentRoot.dev!==directory.dev||currentRoot.ino!==directory.ino)throw Error('Download journal changed unexpectedly');
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if(!text.startsWith('ready\n')){
   if('ready\n'.startsWith(text))return {ready:false,text};
   throw Error('Invalid native download ready marker');
  }
  parseDownloadJournal(text);return {ready:true,text};
 }finally{await file.close();}
}
export async function waitForDownloadReady(root,{timeoutMs=5000,pollMs=100,signal}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(pollMs)||pollMs<1||pollMs>1000)throw Error('Invalid readiness wait limits');
 const deadline=performance.now()+timeoutMs;
 while(true){
  signal?.throwIfAborted();
  const result=await readNativeDownloadJournal(root);
  signal?.throwIfAborted();
  if(result.ready)return result;
  const remaining=deadline-performance.now();if(remaining<=0)throw Error('Native download manager is not ready');
  await delay(Math.min(pollMs,remaining),undefined,{signal});
 }
}
