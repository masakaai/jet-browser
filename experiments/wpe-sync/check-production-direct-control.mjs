import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {WebSocket} from 'ws';

const api=process.env.API_ORIGIN||'https://masaka-backend.vercel.app';
const fixture=`https://masaka-ai.vercel.app/browser-check.html?direct=${Date.now()}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const config=await (await fetch(`${api}/api/config`)).json();
const auth=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await auth.auth.signInWithPassword({email:process.env.TEST_ACCOUNT_EMAIL,password:process.env.TEST_ACCOUNT_PASSWORD});
if(login.error)throw login.error;
const token=login.data.session.access_token;

async function request(path,method='GET',body,control){
 const response=await fetch(`${api}/api/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(control?{'X-Masaka-Control':control}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok)throw Error(data.error||`Request failed (${response.status})`);return data;
}
async function waitSession(id,predicate){for(let index=0;index<150;index++){const value=await request(`sessions/${id}`);if(predicate(value))return value;if(value.status==='failed')throw Error(value.error||'Session failed');await sleep(400);}throw Error('Session wait timed out');}
function direct(ticket){
 const socket=new WebSocket(ticket.url.replace(/\/$/,'')+'/v1/session'),events=[],waiters=[];let pendingBinary=null;
 const deliver=value=>{events.push(value);for(const waiter of [...waiters])if(events.length>waiter.from&&waiter.predicate(value)){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(value);}};
 socket.on('message',(data,isBinary)=>{if(isBinary){const type=pendingBinary;pendingBinary=null;if(type)deliver({type,bytes:data.byteLength});return;}let message;try{message=JSON.parse(data.toString('utf8'));}catch{return;}if(message.type==='binary'){pendingBinary=message.event;return;}deliver(message);});
 socket.on('close',(code,reason)=>{const error=Error(`Direct connection closed (${code}: ${String(reason)})`);for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}});
 const waitFor=(predicate,{timeout=20000,from=events.length}={})=>new Promise((resolve,reject)=>{for(let index=from;index<events.length;index++)if(predicate(events[index]))return resolve(events[index]);const waiter={predicate,from,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('Direct event timed out'));},timeout)};waiters.push(waiter);});
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Direct connection timed out')),15000);socket.once('open',()=>socket.send(JSON.stringify({type:'authorize',ticket:ticket.ticket})));waitFor(value=>value.type==='ready').then(value=>{clearTimeout(timer);resolve(value);},reject);socket.once('error',reject);});
 return {socket,events,ready,waitFor,close:()=>new Promise(resolve=>{if(socket.readyState>=WebSocket.CLOSING)return resolve();socket.once('close',resolve);socket.close(1000,'E2E complete');})};
}

let session,view,input,control,stage='launch';
const latency=[];
try{
 session=await request('sessions','POST',{name:'Direct Visual control E2E',url:'https://duckduckgo.com/',max_seconds:120});
 assert.equal(session.preview_mode,'visual');
 session=await waitSession(session.id,value=>value.status==='running'&&value.preview_transport==='direct');
 const viewTicket=await request(`sessions/${session.id}/ticket`,'POST',{});
 view=direct(viewTicket);const viewReady=await view.ready;
 assert.equal(viewReady.payload.preview_mode,'visual');
 stage='initial-frame';await view.waitFor(value=>value.type==='frame'||value.type==='frame-chunk',{timeout:30000,from:0});
 const initialTabState=viewReady.payload.tabs?.length?viewReady.payload:(await view.waitFor(value=>value.type==='tabs'&&value.payload?.tabs?.length,{timeout:30000,from:0})).payload,
  initialTabs=initialTabState.tabs,original=initialTabs.find(tab=>tab.handle===initialTabState.active_tab)?.handle;
 assert.ok(original);
 control=await request(`sessions/${session.id}/control`,'POST',{mode:'human'});
 const inputTicket=control.data_plane||await request(`sessions/${session.id}/ticket`,'POST',{},control.token);
 input=direct(inputTicket);const inputReady=await input.ready;assert.equal(inputReady.payload.scope,'input');
 let seq=0;
 const action=async value=>{const id=++seq,started=performance.now(),from=input.events.length;input.socket.send(JSON.stringify({...value,seq:id}));const response=await input.waitFor(message=>(message.type==='ack'||message.type==='error')&&message.seq===id,{from,timeout:30000});if(response.type==='error')throw Error(response.error);latency.push(Math.round(performance.now()-started));return response;};
 stage='input';await action({type:'input',events:[{type:'pointer',phase:'move',x:420,y:260,button:0},{type:'wheel',x:420,y:260,delta_x:0,delta_y:120}]});
 const newTabsFrom=view.events.length,newTabsEvent=view.waitFor(value=>value.type==='tabs'&&value.payload?.tabs?.length===2,{from:newTabsFrom});
 stage='tab-new';await action({type:'tab-new'});const newTabs=(await newTabsEvent).payload,newHandle=newTabs.active_tab;assert.notEqual(newHandle,original);
 const switchedFrom=view.events.length,switched=view.waitFor(value=>value.type==='tabs'&&value.payload?.active_tab===original,{from:switchedFrom});
 stage='tab-switch';await action({type:'tab-switch',handle:original});await switched;
 const closedFrom=view.events.length,closed=view.waitFor(value=>value.type==='tabs'&&value.payload?.tabs?.length===1,{from:closedFrom});
 stage='tab-close';await action({type:'tab-close',handle:newHandle});await closed;
 const resetFrom=view.events.length,reset=view.waitFor(value=>value.type==='preview-reset',{from:resetFrom}),frame=view.waitFor(value=>value.type==='frame'||value.type==='frame-chunk',{from:resetFrom,timeout:30000});
 stage='navigate';await action({type:'navigate',url:fixture});stage='navigate-reset';await reset;stage='navigate-frame';await frame;
 await request(`sessions/${session.id}/control`,'DELETE',undefined,control.token);control=null;
 const settled=await waitSession(session.id,value=>value.url?.startsWith(fixture));
 assert.match(settled.worker_id,/^deeptensor-wpe-0[12]$/);
 console.log(JSON.stringify({status:'PASS',session:session.id,worker:settled.worker_id,previewMode:settled.preview_mode,transport:settled.preview_transport,frames:view.events.filter(value=>value.type==='frame'||value.type==='frame-chunk').length,tabs:{created:true,switched:true,closed:true},inputAckMs:{min:Math.min(...latency),max:Math.max(...latency),average:Math.round(latency.reduce((sum,value)=>sum+value,0)/latency.length)}}));
}catch(error){
 console.error(JSON.stringify({status:'FAIL',stage,error:error.message,viewEvents:view?.events.map(value=>value.type).slice(-40),inputEvents:input?.events.map(value=>value.type).slice(-20)}));
 throw error;
}finally{
 await input?.close().catch(()=>{});await view?.close().catch(()=>{});
 if(control&&session)await request(`sessions/${session.id}/control`,'DELETE',undefined,control.token).catch(()=>{});
 if(session){await request(`sessions/${session.id}/stop`,'POST',{}).catch(()=>{});await waitSession(session.id,value=>['completed','failed'].includes(value.status)).catch(()=>{});}
 await auth.auth.signOut({scope:'local'});auth.realtime.disconnect();
}
