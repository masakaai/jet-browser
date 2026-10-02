import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createCipheriv} from 'node:crypto';
import {DownloadPublisher} from '../src/download-publisher.mjs';
const backend=await Promise.all([import('../../backend/src/security.mjs'),import('../../backend/src/downloads.mjs')]).catch(()=>null);
const encrypt=(value,owner,key)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAAD(Buffer.from(owner));const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(part=>part.toString('base64url')).join('.');};
const sessionId='649ab2c8-a444-4a22-8444-123456789abc',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',projectId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id='80c670f2-7829-4b3f-94f3-b07c2dfadc39';
const content=Buffer.from('publisher 中文');
const journal=`ready\nstarted\t${id}\t0\t0\nname\t${id}\tZmlsZS50eHQ=\ndestination\t${id}\t0\t0\nfinished\t${id}\t${content.length}\t0\n`;
test('failure receipts retry identically, deduplicate and share the one-operation budget',()=>fixture(async options=>{
 const bad='80c670f2-7829-4b3f-94f3-b07c2dfadc40',calls=[],files=[];
 const snapshot=journal+journal.slice(6).replaceAll(id,bad).replace(/\t0\n$/,'\t1\n');
 const publisher=new DownloadPublisher({...options,rpc:async(name,p)=>files.push(p.p_id),reportFailure:async p=>{calls.push(p);if(calls.length===1)throw Error('lost failure ack');}});
 await assert.rejects(publisher.flush(snapshot),/lost failure ack/);assert.deepEqual(files,[]);
 const retry=await publisher.flush(snapshot);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],{p_session:sessionId,p_worker:'fixture-worker',p_id:bad});
 assert.deepEqual(retry.reportedFailures,[bad]);assert.deepEqual(retry.unpublished,[id]);assert.deepEqual(files,[]);
 assert.deepEqual((await publisher.flush(snapshot)).published,[id]);
 await publisher.flush(snapshot);assert.equal(calls.length,2);assert.deepEqual(files,[id]);await publisher.close();
}));
async function fixture(run){
 const root=await realpath(await mkdtemp(join(tmpdir(),'masaka-publish-test-')));const key=randomBytes(32).toString('hex');
 await writeFile(join(root,id),content);
 const options={sessionId,owner,projectId,worker:'fixture-worker',root,encrypt:(value,user)=>encrypt(value,user,key)};
 try{await run(options,key);}finally{await rm(root,{recursive:true,force:true});}
}
test('native file is encrypted with session binding and decodes through real backend codec',{skip:!backend},()=>fixture(async(options,key)=>{
 const calls=[];const publisher=new DownloadPublisher({...options,rpc:async(name,params)=>calls.push({name,params})});
 const result=await publisher.flush(journal);assert.deepEqual(result.published,[id]);
 await publisher.flush(journal);assert.equal(calls.length,1);
 const {name,params:p}=calls[0];assert.equal(name,'publish_browser_download');assert.equal(p.p_session,sessionId);assert.equal(p.p_worker,'fixture-worker');
 const decoded=backend[1].decodeDownload({id,session_id:sessionId,user_id:owner,project_id:projectId,name:p.p_name,size:p.p_size,sha256:p.p_sha256,encrypted_content:p.p_encrypted_content},{id:sessionId,user_id:owner,project_id:projectId},key);
 assert.deepEqual(decoded,content);await publisher.close();await assert.rejects(publisher.flush(journal),/closed/);
}));
test('ambiguous publish can recover only a strict true receipt without sending ciphertext to the reader',()=>fixture(async options=>{
 for(const response of [false,undefined,'true',true]){
  let confirmation;
  const publisher=new DownloadPublisher({...options,rpc:async()=>{throw Error('publish response lost');},confirmReceipt:async receipt=>{confirmation=receipt;return response;}});
  if(response===true)assert.deepEqual((await publisher.flush(journal)).published,[id]);
  else await assert.rejects(publisher.flush(journal),/publish response lost/);
  assert.equal(confirmation.p_id,id);assert.equal(confirmation.p_session,sessionId);assert.ok(!('p_encrypted_content' in confirmation));
  await publisher.close();
 }
 const publisher=new DownloadPublisher({...options,rpc:async()=>{throw Error('original failure');},confirmReceipt:async()=>{throw Error('receipt unavailable');}});
 await assert.rejects(publisher.flush(journal),/original failure/);await publisher.close();
}));
test('ambiguous publication retains identical envelope for idempotent next poll; concurrent polls coalesce',()=>fixture(async options=>{
 const calls=[];let release;const gate=new Promise(resolve=>release=resolve);
 const publisher=new DownloadPublisher({...options,rpc:async(name,p)=>{calls.push(p);if(calls.length===1){await gate;throw Error('ack lost');}}});
 const first=publisher.flush(journal),parallel=publisher.flush(journal);assert.equal(first,parallel);
 release();await assert.rejects(first,/ack lost/);assert.equal(calls.length,1);
 await publisher.flush(journal);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 await publisher.flush(journal);assert.equal(calls.length,2);await publisher.close();
}));
test('failed/incomplete downloads never publish; closing drains an already submitted RPC',()=>fixture(async options=>{
 let calls=0,release,submitted;const begun=new Promise(resolve=>submitted=resolve),gate=new Promise(resolve=>release=resolve);
 const publisher=new DownloadPublisher({...options,rpc:async()=>{calls++;submitted();await gate;}});
 await publisher.flush(journal.replace(/\t0\n$/,'\t1\n'));assert.equal(calls,0);
 await publisher.flush(journal.slice(0,journal.lastIndexOf('finished')));assert.equal(calls,0);
 const flush=publisher.flush(journal);await begun;
 let closed=false;const close=publisher.close().then(()=>closed=true);await Promise.resolve();assert.equal(closed,false);
 await assert.rejects(publisher.flush(journal),/closed/);release();await flush;await close;assert.equal(calls,1);
}));
test('each poll publishes at most one file and reports the completed backlog separately',()=>fixture(async options=>{
 const ids=[id,'80c670f2-7829-4b3f-94f3-b07c2dfadc40','80c670f2-7829-4b3f-94f3-b07c2dfadc41'];
 for(const next of ids.slice(1))await writeFile(join(options.root,next),content);
 const snapshot='ready\n'+ids.map(next=>journal.slice(6).replaceAll(id,next)).join('');
 const calls=[];
 const publisher=new DownloadPublisher({...options,rpc:async(name,p)=>calls.push(p.p_id)});
 for(let index=0;index<ids.length;index++){
  const result=await publisher.flush(snapshot);
  assert.deepEqual(result.published,[ids[index]]);
  assert.deepEqual(result.unpublished,ids.slice(index+1));
  assert.deepEqual(result.pending,[]);
  assert.equal(calls.length,index+1);
 }
 const result=await publisher.flush(snapshot);
 assert.deepEqual(result.published,[]);assert.deepEqual(result.unpublished,[]);
 assert.deepEqual(calls,ids);await publisher.close();
}));
test('a lost acknowledgement blocks later files until the same payload is acknowledged',()=>fixture(async options=>{
 const second='80c670f2-7829-4b3f-94f3-b07c2dfadc40';
 await writeFile(join(options.root,second),content);
 const snapshot=journal+journal.slice(6).replaceAll(id,second),calls=[];
 const publisher=new DownloadPublisher({...options,rpc:async(name,p)=>{calls.push(p);if(calls.length===1)throw Error('ack lost');}});
 await assert.rejects(publisher.flush(snapshot),/ack lost/);
 assert.deepEqual(calls.map(p=>p.p_id),[id]);
 const retried=await publisher.flush(snapshot);
 assert.deepEqual(calls[0],calls[1]);assert.deepEqual(retried.unpublished,[second]);
 const next=await publisher.flush(snapshot);
 assert.deepEqual(next.published,[second]);assert.deepEqual(next.unpublished,[]);
 assert.deepEqual(calls.map(p=>p.p_id),[id,id,second]);await publisher.close();
}));
