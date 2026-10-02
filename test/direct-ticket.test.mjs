import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyDirectTicket } from '../src/direct-ticket.mjs';
import { enqueueSocketMessage, queueSemanticControl, releaseReboundSocketInput, revokeDirectControl } from '../src/direct-server.mjs';

const secret='s'.repeat(32),issue=claims=>{const body=Buffer.from(JSON.stringify({v:1,...claims})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
test('worker verifies current signed tickets',()=>{
 const claims=verifyDirectTicket(issue({sid:'s',exp:Math.floor(Date.now()/1000)+10}),secret);assert.equal(claims.sid,'s');
});
test('worker rejects expired tickets',()=>assert.throws(()=>verifyDirectTicket(issue({exp:0}),secret),/Expired/));

test('signed revocation fences clients and releases held browser input',async()=>{
 const sent=[],peer={masaka:{claims:{scope:'input'}},readyState:1,bufferedAmount:0,send:value=>sent.push(JSON.parse(value))},control={row:{user_id:'u',project_id:'p',preview_mode:'visual'},controlEpoch:4,clients:new Set([peer]),async releaseInput(){this.released=true;},endInput(){this.ended=true;}};
 const result=await revokeDirectControl(new Map([['s',control]]),'w',{scope:'revoke',sid:'s',uid:'u',pid:'p',wid:'w',mode:'visual',epoch:5});
 assert.deepEqual(result,{revoked:true,epoch:5});assert.equal(peer.masaka.claims.scope,'view');assert.equal(control.released,true);assert.equal(control.ended,true);assert.equal(sent[0].type,'control-revoked');
 await assert.rejects(revokeDirectControl(new Map([['s',control]]),'w',{scope:'view',sid:'s',uid:'u',pid:'p',wid:'w',mode:'visual',epoch:6}),/Invalid/);
});
test('a delayed older revocation cannot demote the newer controller',async()=>{
 let released=0;const peer={masaka:{claims:{scope:'input',epoch:7}},readyState:1,bufferedAmount:0,send:()=>{}},control={row:{user_id:'u',project_id:'p',preview_mode:'visual'},controlEpoch:7,clients:new Set(),releaseInput:async()=>released++};control.clients.add(peer);
 const result=await revokeDirectControl(new Map([['s',control]]),'w',{scope:'revoke',sid:'s',uid:'u',pid:'p',wid:'w',mode:'visual',epoch:6});
 assert.deepEqual(result,{revoked:false,stale:true,epoch:7});assert.equal(peer.masaka.claims.scope,'input');assert.equal(released,0);
});
test('reauthorizing a socket for another session releases held input in the old session',async()=>{
 let released=0,ended=0;const previous={releaseInput:async()=>released++,endInput:()=>ended++};
 const socket={masaka:{claims:{scope:'input'},control:previous}};
 assert.equal(await releaseReboundSocketInput(socket,{}),true);
 assert.equal(socket.masaka.claims.scope,'view');assert.equal(released,1);assert.equal(ended,1);
 assert.equal(await releaseReboundSocketInput(socket,{}),false);assert.equal(released,1);
});
test('socket messages serialize authorization transitions across awaited engine work',async()=>{
 const socket={},order=[];let releaseFirst;const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
 const first=enqueueSocketMessage(socket,async()=>{order.push('first-start');await firstGate;order.push('first-end');});
 const second=enqueueSocketMessage(socket,async()=>{order.push('second');});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(order,['first-start']);
 releaseFirst();await Promise.all([first,second]);assert.deepEqual(order,['first-start','first-end','second']);
});
test('a close fence suppresses already queued socket work before cleanup',async()=>{
 const socket={masakaClosed:false},order=[];let releaseFirst;const gate=new Promise(resolve=>{releaseFirst=resolve;});
 const first=enqueueSocketMessage(socket,async()=>{order.push('running');await gate;});
 const queued=enqueueSocketMessage(socket,async()=>{if(!socket.masakaClosed)order.push('stale-input');});
 socket.masakaClosed=true;const cleanup=enqueueSocketMessage(socket,async()=>{order.push('cleanup');});
 releaseFirst();await Promise.all([first,queued,cleanup]);assert.deepEqual(order,['running','cleanup']);
});
test('full Live DOM resync requests coalesce while one is pending',()=>{
 let wakes=0;const control={semanticControls:[],wake:()=>wakes++};
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'first'}),true);
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'duplicate'}),false);
 assert.equal(queueSemanticControl(control,'dash:ps-subtree-request',{nid:'1'}),true);
 assert.deepEqual(control.semanticControls.map(value=>value.type),['dash:dom-stream-start','dash:ps-subtree-request']);
 assert.equal(wakes,1);
});
test('viewer semantic requests have a bounded queue and byte budget',()=>{
 const control={semanticControls:[],semanticControlBytes:0};
 for(let index=0;index<64;index++)assert.equal(queueSemanticControl(control,'dash:ps-subtree-request',{nid:String(index)}),true);
 assert.equal(queueSemanticControl(control,'dash:ps-subtree-request',{nid:'overflow'}),false);
 assert.ok(control.semanticControlBytes>0&&control.semanticControlBytes<=1_000_000);
 const bytesBefore=control.semanticControlBytes;
 assert.equal(queueSemanticControl({semanticControls:[],semanticControlBytes:999_990},'dash:ps-subtree-request',{nid:'too-large'}),false);
 assert.equal(control.semanticControlBytes,bytesBefore);
});
