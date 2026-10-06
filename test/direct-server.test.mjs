import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acknowledgeSemantic,createDirectServer,DIRECT_ACTION_TYPES,expectSemanticAcknowledgement,frameBackpressured,queueSemanticControl,renderDirectMetrics,requireFreshInputTicket} from '../src/direct-server.mjs';

test('direct input protocol includes real browser tab lifecycle actions',()=>{
 assert.deepEqual([...DIRECT_ACTION_TYPES],['input','navigate','tab-switch','tab-new','tab-close']);
});

test('short-lived copied connection URLs authorize without exposing a second credential field',()=>{
 const source=readFileSync(new URL('../src/direct-server.mjs',import.meta.url),'utf8');
 assert.match(source,/new URL\(request\.url,'http:\/\/localhost'\)\.searchParams\.get\('ticket'\)/);
 assert.match(source,/authorize\(socket,queryTicket\)/);
 assert.match(source,/queryTicket\.length<=4096/);
});

test('Visual backpressure skips only the next whole stale frame',()=>{
 const socket={bufferedAmount:64_001};
 assert.equal(frameBackpressured(socket,'frame'),true);
 assert.equal(frameBackpressured(socket,'frame-start'),true);
 assert.equal(frameBackpressured(socket,'frame-chunk'),false);
 assert.equal(frameBackpressured({bufferedAmount:64_000},'frame'),false);
});

test('direct runtime metrics are bounded, aggregate, and label-free',()=>{
 const active=new Map([['session-a',{}],['session-b',{}]]),sockets=new Set([
  {readyState:1,bufferedAmount:120,masaka:{claims:{scope:'view'}}},
  {readyState:1,bufferedAmount:80,masaka:{claims:{scope:'input'}}},
  {readyState:3,bufferedAmount:999,masaka:{claims:{scope:'view'}}}
 ]);
 const output=renderDirectMetrics(active,sockets,{authorized:4,authorizationFailures:1,inputActions:3,inputProcessingMs:27,previewMessages:8,previewBackpressureDrops:2,slowClientDisconnects:1});
 assert.match(output,/masaka_direct_active_sessions 2/);
 assert.match(output,/masaka_direct_connections 3/);
 assert.match(output,/masaka_direct_view_connections 1/);
 assert.match(output,/masaka_direct_input_connections 1/);
 assert.match(output,/masaka_direct_socket_buffered_bytes 200/);
 assert.match(output,/masaka_direct_input_processing_milliseconds_total 27/);
 assert.doesNotMatch(output,/session-a|session-b/);
});

test('direct runtime requires a dedicated bearer token for Prometheus metrics',async()=>{
 const token='metrics-test-token-with-at-least-32-characters';
 const server=createDirectServer({active:new Map(),worker:'worker-test',secret:'test-secret',metricsToken:token,port:0,host:'127.0.0.1'});
 try{
  while(!server.address())await new Promise(resolve=>setImmediate(resolve));
  const url=`http://127.0.0.1:${server.address().port}/metrics`;
  assert.equal((await fetch(url)).status,404);
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer wrong'}})).status,404);
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}),body=await response.text();
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/plain/);
  assert.match(body,/masaka_direct_active_sessions 0/);
 }finally{await server.close();}
});

test('direct runtime keeps metrics disabled when no token is configured',async()=>{
 const server=createDirectServer({active:new Map(),worker:'worker-test',secret:'test-secret',port:0,host:'127.0.0.1'});
 try{
  while(!server.address())await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/metrics`)).status,404);
 }finally{await server.close();}
});

test('semantic snapshots remain pending until the viewer acknowledges the envelope',async()=>{
 const control={};
 const receipt=expectSemanticAcknowledgement(control,'abcdefghijklmnopqrst',1000);
 assert.equal(acknowledgeSemantic(control,'abcdefghijklmnopqrst'),true);
 assert.equal(await receipt.promise,true);
 assert.equal(control.semanticAcknowledgements.size,0);
 assert.equal(acknowledgeSemantic(control,'abcdefghijklmnopqrst'),false);
});

test('cancelling an unshipped semantic snapshot releases its receipt',async()=>{
 const control={};
 const receipt=expectSemanticAcknowledgement(control,'12345678901234567890',1000);
 receipt.cancel();
 assert.equal(await receipt.promise,false);
 assert.equal(control.semanticAcknowledgements.size,0);
});

test('full DOM resync requests coalesce while a snapshot is generating or awaiting delivery',()=>{
 const control={semanticControls:[],semanticControlBytes:0,semanticBacklog:[],semanticPriming:true};
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'during-prime'}),false);
 control.semanticPriming=false;
 control.semanticBacklog=[{type:'ext:dom-snapshot',payload:{}}];
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'during-delivery'}),false);
 control.semanticBacklog=[];
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'fresh'}),true);
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'duplicate'}),false);
 assert.equal(control.semanticControls.length,1);
});

test('input expiry is rechecked after beginInput reaches the dispatch boundary',()=>{
 const state={claims:{scope:'input',epoch:4,exp:100},control:{controlEpoch:4}};
 assert.doesNotThrow(()=>requireFreshInputTicket(state,100));
 assert.throws(()=>requireFreshInputTicket(state,101),/expired/);
 const source=readFileSync(new URL('../src/direct-server.mjs',import.meta.url),'utf8');
 assert.match(source,/await state\.control\.beginInput\?\.\(\);[\s\S]{0,300}requireFreshInputTicket\(state\)/);
});
