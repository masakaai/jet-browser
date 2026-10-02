import test from 'node:test';
import assert from 'node:assert/strict';
import {DownloadLoop} from '../src/download-loop.mjs';

test('background kick returns immediately while a slow publication runs and close still drains it',async()=>{
 let release,polls=0,closed=false;
 const loop=new DownloadLoop({poll(){polls++;return new Promise(resolve=>{release=resolve;});}},
  {renewLease:async()=>true,finalize:async()=>{closed=true;return {driverReusable:true};}});
 assert.equal(loop.kick(),true);await Promise.resolve();
 for(let command=0;command<20;command++)assert.equal(loop.kick(),false);
 assert.equal(polls,1);assert.equal(closed,false);
 const closing=loop.close();assert.equal(loop.kick(),false);await Promise.resolve();assert.equal(closed,false);
 release({published:[]});await closing;assert.equal(closed,true);
});

test('background failures report once without unhandled rejection and retain retry backoff',async()=>{
 let time=0,polls=0;const errors=[];
 const loop=new DownloadLoop({async poll(){polls++;throw Error('slow upstream failure');}},
  {renewLease:async()=>true,now:()=>time,onError:error=>{errors.push(error.message);}});
 assert.equal(loop.kick(),true);
 const pending=loop.flight;for(let i=0;i<20;i++)assert.equal(loop.kick(),false);
 await pending.catch(()=>{});assert.deepEqual(errors,['slow upstream failure']);
 time=1999;assert.equal(loop.kick(),false);time=2000;assert.equal(loop.kick(),true);
 await loop.flight.catch(()=>{});assert.equal(polls,2);assert.equal(errors.length,2);
});

test('ordinary download polls coalesce, renew lease, throttle and back off failures',async()=>{
 let time=0,leases=0,polls=0,fail=false;
 const loop=new DownloadLoop({async poll(){polls++;if(fail)throw Error('RPC unavailable');return {published:[]};}},
  {now:()=>time,renewLease:async()=>{leases++;return true;}});
 const first=loop.tick();assert.equal(loop.tick(),first);await first;
 await loop.tick();assert.equal(polls,1);assert.equal(leases,1);
 time=1000;fail=true;await assert.rejects(loop.tick(),/RPC unavailable/);
 time=2999;await loop.tick();assert.equal(polls,2);
 time=3000;fail=false;await loop.tick();assert.equal(polls,3);
});

test('closing fences new polls, waits for an in-flight publication, then closes and drains once',async()=>{
 const calls=[];let release;
 const runtime={poll(){calls.push('poll');return new Promise(resolve=>{release=resolve;});}};
 const loop=new DownloadLoop(runtime,{renewLease:async()=>true,finalize:async value=>{assert.equal(value,runtime);calls.push('finalize');return {driverReusable:true};}});
 const pending=loop.tick();await Promise.resolve();
 const closing=loop.close();assert.equal(loop.close(),closing);
 await loop.tick();assert.deepEqual(calls,['poll']);
 release({published:[]});await pending;assert.deepEqual(await closing,{driverReusable:true});
 assert.deepEqual(calls,['poll','finalize']);await loop.tick();assert.equal(calls.length,2);
});

test('lost lease prevents publication; failed ordinary poll does not suppress final cleanup',async()=>{
 let polls=0,finalized=0;
 const loop=new DownloadLoop({async poll(){polls++;}},{renewLease:async()=>false,finalize:async()=>{finalized++;throw Object.assign(Error('lease lost'),{driverReusable:true});}});
 await assert.rejects(loop.tick(),/lease lost/);assert.equal(polls,0);
 await assert.rejects(loop.close(),error=>error.driverReusable===true);assert.equal(finalized,1);
 await loop.tick();assert.equal(polls,0);
});
