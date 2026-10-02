import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinator} from './reconcile.mjs';
const endpoint=()=>({state:{},async read(){return structuredClone(this.state)},async write(s){this.state=structuredClone(s)}});
test('both directions, deletion, conflicting edits, reconnect without empty-state deletion',async()=>{
 const a=endpoint(),b=endpoint(),sync=coordinator(a,b);
 a.state={cookie:'first',local:'a'};assert.equal((await sync()).status,'synced');assert.deepEqual(a.state,b.state);
 b.state.cookie='rotated';delete b.state.local;await sync();assert.deepEqual(a.state,{cookie:'rotated'});
 a.state.cookie='local';b.state.cookie='remote';assert.equal((await sync()).status,'conflict');assert.equal(a.state.cookie,'local');assert.equal(b.state.cookie,'remote');
 a.state.cookie='remote';await sync();
 const read=b.read;b.read=async()=>{throw Error('offline')};a.state.local='during-offline';await assert.rejects(sync(),/offline/);assert.equal(a.state.local,'during-offline');
 b.read=read;await sync();assert.deepEqual(b.state,a.state);
});
test('partial write failure keeps baseline and retries safely for unchanged peers',async()=>{
 const a=endpoint(),b=endpoint(),sync=coordinator(a,b);a.state.x='new';
 const write=b.write;b.write=async()=>{throw Error('transport failed')};await assert.rejects(sync(),/transport failed/);
 b.write=write;assert.equal((await sync()).status,'synced');assert.deepEqual(b.state,{x:'new'});
});
