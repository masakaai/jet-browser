// Run inside the isolated fixture only; publication uses an in-memory RPC stub.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {startDownloadRuntime} from '../../src/download-runtime.mjs';
import {WpeClient} from '../../src/wpe-client.mjs';
import {unseal} from '../../src/vault.mjs';
import {finalizeDownloads} from '../../src/download-finalize.mjs';
import {readNativeDownloadJournal} from '../../src/download-ready.mjs';
import {parseDownloadJournal} from '../../src/download-journal.mjs';
process.env.VAULT_ENCRYPTION_KEY=randomBytes(32).toString('hex');
const session={id:randomUUID(),user_id:randomUUID(),project_id:randomUUID()};
const calls=[];
const options={session,worker:'isolated-runtime',engineFactory:()=>new WpeClient(spawn('/opt/jet-wpe-download-probe',[],{stdio:['pipe','pipe','pipe']})),rpc:async(name,value)=>{assert.equal(name,'publish_browser_download');calls.push(value);}};
await assert.rejects(startDownloadRuntime({...options,waitReady:async()=>{throw Error('injected ready failure');}}),error=>error.driverReusable===true);
const runtime=await startDownloadRuntime(options);
try{
 await runtime.engine.navigate('https://example.com');
 const content='Runtime publisher 中文 '+randomUUID();
 const result=await runtime.engine.evaluate(`(()=>{const a=document.createElement('a');a.download='runtime.txt';a.href=URL.createObjectURL(new Blob([${JSON.stringify(content)}]));a.textContent='Download';document.body.replaceChildren(a);const r=a.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
 assert.equal(result.exceptionDetails,undefined);const {x,y}=result.result.value;
 await runtime.engine.input([{type:'pointer',phase:'down',x,y,button:0},{type:'pointer',phase:'up',x,y,button:0}]);
 let ready=false;
 for(let attempt=0;attempt<20&&!ready;attempt++){const journal=await readNativeDownloadJournal(runtime.root);ready=parseDownloadJournal(journal.text).completed.length===1;if(!ready)await new Promise(resolve=>setTimeout(resolve,200));}
 assert.equal(ready,true);assert.equal(calls.length,0);
 const finalized=await finalizeDownloads(runtime,{renewLease:async()=>true});
 assert.equal(finalized.driverReusable,true);assert.equal(runtime.engine.sessionId,null);
 assert.equal(finalized.published.length,1);assert.deepEqual(finalized.interrupted,[]);assert.equal(calls.length,1);
 const published=calls[0],decoded=unseal(published.p_encrypted_content,session.user_id);
 assert.equal(decoded.sessionId,session.id);assert.equal(decoded.id,published.p_id);assert.equal(Buffer.from(decoded.content,'base64').toString(),content);
 console.log(JSON.stringify({passed:true,scope:'real worker UID, native create/ready/download/close/read/seal; mocked lease and publication RPC; confirmed close after injected readiness failure',root:runtime.root,downloadId:published.p_id,bytes:published.p_size}));
}finally{await runtime.publisher.close();await runtime.engine.close();}
