import test from 'node:test';
import assert from 'node:assert/strict';
import {MasakaBrowserClient} from '../sdk/browser.mjs';

const project='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});

test('browser SDK scopes requests and uses a human capability for input',async()=>{
 const calls=[];let commandReads=0;
 const fetchImpl=async(url,init)=>{calls.push({url,init});if(url.endsWith('/control'))return response({token:'control-token',mode:'human'});if(url.endsWith('/commands'))return response({id:'command-1'});if(url.endsWith('/commands/command-1'))return response(++commandReads>1?{status:'completed',result:{ok:true}}:{status:'queued'});throw Error(url);};
 const browser=new MasakaBrowserClient({accessToken:'account-token',projectId:project,fetchImpl});
 await browser.takeControl('session-1');
 assert.deepEqual(await browser.pointer('session-1',{phase:'down',x:12.4,y:20.8}),{ok:true});
 assert.equal(calls[0].init.headers['X-Masaka-Project'],project);
 assert.equal(calls[1].init.headers['X-Masaka-Control'],'control-token');
 assert.deepEqual(JSON.parse(calls[1].init.body),{kind:'input',events:[{type:'pointer',phase:'down',x:12,y:21,button:0}]});
});

test('browser SDK fixes preview transport before session launch',async()=>{
 const calls=[],fetchImpl=async(url,init)=>{calls.push({url,init});return response({id:'session-1',preview_mode:'visual'});};
 const browser=new MasakaBrowserClient({accessToken:'account-token',projectId:project,fetchImpl});
 await browser.create({url:'https://duckduckgo.com/',previewMode:'visual'});
 assert.equal(JSON.parse(calls[0].init.body).preview_mode,'visual');
});

test('browser SDK connects to direct worker and assembles chunked frames',async()=>{
 const sent=[];
 class FakeSocket{
  static last;static OPEN=1;
  constructor(url){this.url=url;this.readyState=1;FakeSocket.last=this;queueMicrotask(()=>this.onopen?.());}
  send(value){sent.push(JSON.parse(value));if(sent.at(-1).type==='authorize')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'ready',payload:{scope:'view'}})}));}
  emit(value){this.onmessage?.({data:value});}
  close(code,reason){this.readyState=3;this.closed={code,reason};this.onclose?.();}
 }
 let calls=0;const fetchImpl=async()=>response(++calls===1?{id:'session-1',preview_transport:'direct'}:{url:'wss://worker.example',ticket:'signed-ticket',expires_at:new Date(Date.now()+60000).toISOString()});
 const frames=[],statuses=[],browser=new MasakaBrowserClient({accessToken:'account-token',projectId:project,fetchImpl,WebSocketImpl:FakeSocket});
 const handle=await browser.preview('session-1',{onFrame:value=>frames.push([...value]),onStatus:value=>statuses.push(value)}),socket=FakeSocket.last;
 socket.emit(JSON.stringify({type:'frame-start',payload:{total:2,size:4}}));
 socket.emit(JSON.stringify({type:'binary',event:'frame-chunk',length:2}));socket.emit(new Uint8Array([1,2]).buffer);
 socket.emit(JSON.stringify({type:'binary',event:'frame-chunk',length:2}));socket.emit(new Uint8Array([3,4]).buffer);
 assert.deepEqual(frames,[[1,2,3,4]]);assert.equal(sent[0].type,'authorize');assert.ok(statuses.includes('SUBSCRIBED'));await handle.close();assert.equal(socket.closed.code,1000);
});

test('browser SDK rejects when the direct socket closes before authorization',async()=>{
 class ClosingSocket{constructor(){queueMicrotask(()=>this.onclose?.());}close(){}}
 const fetchImpl=async()=>response({url:'wss://worker.example',ticket:'signed-ticket',expires_at:new Date(Date.now()+60000).toISOString()});
 const browser=new MasakaBrowserClient({accessToken:'account-token',projectId:project,fetchImpl,WebSocketImpl:ClosingSocket});
 await assert.rejects(browser.preview('session-1'),/connection closed/);
});

test('browser SDK closes the direct socket when worker authorization fails',async()=>{
 class RejectingSocket{
  static last;constructor(){this.readyState=1;RejectingSocket.last=this;queueMicrotask(()=>this.onopen?.());}
  send(){queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'error',error:'Ticket rejected'})}));}
  close(code,reason){this.closed={code,reason};}
 }
 const fetchImpl=async url=>response(url.endsWith('/ticket')?{url:'wss://worker.example',ticket:'bad-ticket',expires_at:new Date(Date.now()+60000).toISOString()}:{id:'session-1'}),browser=new MasakaBrowserClient({accessToken:'account-token',projectId:project,fetchImpl,WebSocketImpl:RejectingSocket});
 await assert.rejects(browser.preview('session-1'),/Ticket rejected/);assert.deepEqual(RejectingSocket.last.closed,{code:1000,reason:'Preview initialization failed'});
});

test('browser SDK does not renew tickets after a remote close during refresh',async()=>{
 const timers=new Map();let timerId=0,finishRenew,calls=0;
 const setTimeoutImpl=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
 const clearTimeoutImpl=id=>timers.delete(id);
 class RefreshSocket{
  static last;constructor(){this.readyState=1;this.sent=[];RefreshSocket.last=this;queueMicrotask(()=>this.onopen?.());}
  send(value){this.sent.push(JSON.parse(value));if(this.sent.length===1)queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'ready',payload:{scope:'view'}})}));}
  remoteClose(){this.readyState=3;this.onclose?.();}
  close(){this.readyState=3;}
 }
 const ticket={url:'wss://worker.example',ticket:'signed-ticket',expires_at:new Date(Date.now()+60000).toISOString()};
 const fetchImpl=async()=>{calls++;if(calls===1)return response({id:'session-1'});if(calls===2)return response(ticket);return new Promise(resolve=>{finishRenew=resolve;});};
 const browser=new MasakaBrowserClient({accessToken:'account-token',projectId:project,fetchImpl,WebSocketImpl:RefreshSocket,setTimeoutImpl,clearTimeoutImpl});
 await browser.preview('session-1');
 const refresh=[...timers.values()].find(timer=>timer.delay!==15000);assert.ok(refresh);
 const renewal=refresh.callback();while(!finishRenew)await Promise.resolve();
 RefreshSocket.last.remoteClose();finishRenew(response(ticket));await renewal;
 assert.equal(timers.size,0);assert.equal(RefreshSocket.last.sent.length,1);
});

test('failed human-control release retains its capability for retry',async()=>{
 let releases=0;
 const browser=new MasakaBrowserClient({accessToken:'account-token',projectId:project,fetchImpl:async url=>{if(url.endsWith('/control')&&++releases===1)return response({error:'handoff unavailable'},503);return response({mode:'agent'});}});
 browser.controls.set('session-1','human-capability');
 await assert.rejects(browser.releaseControl('session-1'),/handoff unavailable/);
 assert.equal(browser.controls.get('session-1'),'human-capability');
 assert.deepEqual(await browser.releaseControl('session-1'),{mode:'agent'});
 assert.equal(browser.controls.has('session-1'),false);
 assert.equal(releases,2);
});
