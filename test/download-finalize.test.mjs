import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeDownloads} from '../src/download-finalize.mjs';
function fixture(results){
 const calls=[];const engine={sessionId:'native',async close(){calls.push('close');this.sessionId=null;}};
 const runtime={engine,publisher:{async close(){calls.push('publisher-close');}},async poll(){calls.push('poll');return results.shift();}};
 return {runtime,calls,options:{renewLease:async()=>{calls.push('lease');return true;}}};
}
test('failure acknowledgements count as progress without becoming published files',async()=>{
 const f=fixture([{published:[],reportedFailures:['bad'],unpublished:['file'],failed:['bad'],pending:[]},{published:['file'],unpublished:[],failed:['bad'],pending:[]}]);
 assert.deepEqual(await finalizeDownloads(f.runtime,f.options),{driverReusable:true,published:['file'],failed:['bad'],interrupted:[]});
 const invalid=fixture([{published:[],reportedFailures:'bad',unpublished:['file'],failed:[],pending:[]}]);
 await assert.rejects(finalizeDownloads(invalid.runtime,invalid.options),/Invalid final download snapshot/);
});
test('closes native browser then renews lease before every bounded publication and reports interrupted files',async()=>{
 const f=fixture([{published:['one'],unpublished:['two'],failed:[],pending:['partial']},{published:['two'],unpublished:[],failed:['bad'],pending:['partial']}]);
 const result=await finalizeDownloads(f.runtime,f.options);
 assert.deepEqual(f.calls,['close','lease','poll','lease','poll','publisher-close']);
 assert.deepEqual(result,{driverReusable:true,published:['one','two'],failed:['bad'],interrupted:['partial']});
});
test('unknown native close quarantines slot and does not publish from a live writer',async()=>{
 const f=fixture([]);f.runtime.engine.close=async()=>{throw Error('unknown close');};
 await assert.rejects(finalizeDownloads(f.runtime,f.options),error=>error.driverReusable===false&&/unknown close/.test(error.message));
 assert.deepEqual(f.calls,['publisher-close']);
});
test('lost lease or failed publication cannot report successful drain',async()=>{
 for(const stage of ['lease','publish']){
  const f=fixture([]);if(stage==='lease')f.options.renewLease=async()=>false;else f.runtime.poll=async()=>{throw Error('RPC unavailable');};
  await assert.rejects(finalizeDownloads(f.runtime,f.options),error=>error.driverReusable===true);
  assert.equal(f.calls.at(-1),'publisher-close');
 }
});
test('time budget never starts another publication after deadline and preserves backlog in the failure',async()=>{
 const f=fixture([{published:['one'],unpublished:['two'],pending:[],failed:[]}]);let time=0;
 const poll=f.runtime.poll;f.runtime.poll=async()=>{const value=await poll();time=100;return value;};
 await assert.rejects(finalizeDownloads(f.runtime,{...f.options,timeoutMs:50,now:()=>time}),error=>error.driverReusable===true&&error.unpublished[0]==='two');
 assert.deepEqual(f.calls,['close','lease','poll','publisher-close']);
});
