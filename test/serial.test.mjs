import test from 'node:test';
import assert from 'node:assert/strict';
import {createSerialExecutor} from '../src/serial.mjs';

test('complete browser actions remain ordered across asynchronous boundaries',async()=>{
 const queue=createSerialExecutor(),events=[];let release;
 const first=queue.run(async()=>{events.push('navigate:start');await new Promise(resolve=>{release=resolve;});events.push('navigate:end');});
 const second=queue.run(async()=>events.push('input'));
 await Promise.resolve();assert.deepEqual(events,['navigate:start']);release();await Promise.all([first,second]);assert.deepEqual(events,['navigate:start','navigate:end','input']);
});

test('a failed action does not poison the following action',async()=>{
 const queue=createSerialExecutor(),events=[];await assert.rejects(queue.run(async()=>{throw Error('failed');}),/failed/);await queue.run(async()=>events.push('next'));await queue.drain();assert.deepEqual(events,['next']);
});
