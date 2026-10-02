import test from 'node:test';
import assert from 'node:assert/strict';
import {createLeaseRenewer} from '../src/session-lease.mjs';

test('concurrent browser and publisher heartbeat requests share one write and use sent timestamp',async()=>{
 let time=1000,release;const writes=[];
 const renew=createLeaseRenewer(value=>{writes.push(value);return new Promise(resolve=>{release=resolve;});},{now:()=>time});
 const browser=renew(),publisher=renew();assert.equal(browser,publisher);await Promise.resolve();
 time=11000;release(true);
 assert.deepEqual(await browser,{heartbeatAt:1000,deadline:31000});assert.deepEqual(writes,['1970-01-01T00:00:01.000Z']);
});

test('late acceptance cannot extend expired database lease; rejected or failed writes never renew it',async()=>{
 let time=0,release;
 const renew=createLeaseRenewer(()=>new Promise(resolve=>{release=resolve;}),{now:()=>time});
 const pending=renew();await Promise.resolve();time=30000;release(true);assert.equal(await pending,null);
 const rejected=renew();await Promise.resolve();release(false);assert.equal(await rejected,null);
 let calls=0;const retry=createLeaseRenewer(async()=>{if(++calls===1)throw Error('offline');return true;},{now:()=>time});
 await assert.rejects(retry(),/offline/);assert.deepEqual(await retry(),{heartbeatAt:30000,deadline:60000});
});
