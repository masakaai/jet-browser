// Run only in the isolated container with the candidate hook installed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {startDownloadRuntime} from '../../src/download-runtime.mjs';
import {WpeClient} from '../../src/wpe-client.mjs';
import {readNativeDownloadJournal} from '../../src/download-ready.mjs';
import {parseDownloadJournal} from '../../src/download-journal.mjs';
const session={id:randomUUID(),user_id:randomUUID(),project_id:randomUUID()};
const runtime=await startDownloadRuntime({session,worker:'budget-fixture',engineFactory:()=>new WpeClient(),rpc:async()=>{throw Error('No publication in native budget test');}});
async function download(name,size){
 const result=await runtime.engine.evaluate(`(()=>{const a=document.createElement('a');a.download=${JSON.stringify(name)};a.href=URL.createObjectURL(new Blob([new Uint8Array(${size})]));a.textContent='Download';document.body.replaceChildren(a);const r=a.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
 assert.equal(result.exceptionDetails,undefined);const {x,y}=result.result.value;
 await runtime.engine.input([{type:'pointer',phase:'down',x,y,button:0},{type:'pointer',phase:'up',x,y,button:0}]);
}
async function waitFor(check){
 let state;
 for(let i=0;i<40;i++){
  state=parseDownloadJournal((await readNativeDownloadJournal(runtime.root)).text);
  if(check(state))return state;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.fail('Native download state did not reach expected terminal: '+JSON.stringify(state));
}
try{
 await runtime.engine.navigate('https://example.com');
 await download('x'.repeat(201),8);
 const rejected=await waitFor(state=>state.failed.length===1);
 assert.equal(rejected.completed.length,0);assert.deepEqual(rejected.pending,[]);
 assert.deepEqual(await readdir(runtime.root),['events.tsv']);
 await download('正常.txt',32);
 const normal=await waitFor(state=>state.completed.length===1);
 assert.equal(normal.completed[0].name,'正常.txt');assert.equal(normal.completed[0].bytes,32);
 assert.deepEqual(await readFile(runtime.root+'/'+normal.completed[0].id),Buffer.alloc(32));
 await download('large.bin',5*1024*1024);
 const large=await waitFor(state=>state.failed.length===2);
 assert.equal(large.completed.length,1);assert.deepEqual(large.pending,[]);
 await runtime.engine.close();assert.equal(runtime.engine.sessionId,null);
 console.log(JSON.stringify({passed:true,root:runtime.root,checks:['201-byte filename canceled before file creation','normal download after rejection succeeds','5 MiB file fails','journal remains parseable','native close confirmed']}));
}finally{await runtime.publisher.close();await runtime.engine.close();}
