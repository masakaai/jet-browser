import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyDirectTicket } from './direct-ticket.mjs';
import { CONTROL_TYPES } from './semantic-preview.mjs';

const json = (socket, value) => {
  if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 8_000_000) return false;
  socket.send(JSON.stringify(value)); return true;
};

const requireCurrentInput = state => {
  if(state.claims.scope!=='input'||!Number.isSafeInteger(state.claims.epoch)||state.claims.epoch!==state.control.controlEpoch)throw Error('Stale browser control ticket');
};

export const DIRECT_ACTION_TYPES=new Set(['input','navigate','tab-switch','tab-new','tab-close']);
const readyPayload=(state,scope)=>({session_id:state.claims.sid,scope,preview_mode:state.claims.mode,viewport:state.control.row.viewport||{width:1280,height:800},tabs:state.control.tabs||[],active_tab:state.control.activeTab||null});

const releaseInput=async control=>{try{await control.releaseInput?.();}finally{control.endInput?.();}};

export async function releaseReboundSocketInput(socket,nextControl){
  const previous=socket.masaka;
  if(!previous||previous.control===nextControl||previous.claims.scope!=='input')return false;
  // Fence the old capability before awaiting the engine release so a close or
  // another message cannot apply input to the previous browser concurrently.
  previous.claims.scope='view';
  await releaseInput(previous.control);
  return true;
}

export function enqueueSocketMessage(socket,task){
  const next=(socket.masakaMessages||Promise.resolve()).then(task);
  // Keep the per-socket chain usable after a rejected handler. The returned
  // promise still carries the rejection to the caller that owns the message.
  socket.masakaMessages=next.catch(()=>{});
  return next;
}

export function queueSemanticControl(control,type,payload={}){
  if(type==='dash:dom-stream-start'&&(
    control.semanticPriming||
    control.semanticBacklog?.some(message=>message.type==='ext:dom-snapshot')||
    control.semanticControls.some(request=>request.type===type)
  ))return false;
  let size;try{size=Buffer.byteLength(JSON.stringify({type,payload}));}catch{return false;}
  const bytes=Number(control.semanticControlBytes)||0;
  if(size<=0||size>128_000||control.semanticControls.length>=64||bytes+size>1_000_000)return false;
  control.semanticControls.push({type,payload,size});control.semanticControlBytes=bytes+size;control.wake?.();control.wake=null;return true;
}

export function expectSemanticAcknowledgement(control,id,timeoutMs=8000){
  control.semanticAcknowledgements??=new Map();
  const previous=control.semanticAcknowledgements.get(id);
  if(previous){clearTimeout(previous.timer);previous.resolve(false);}
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  const finish=value=>{
    const current=control.semanticAcknowledgements.get(id);
    if(current?.resolve!==resolve)return;
    clearTimeout(current.timer);control.semanticAcknowledgements.delete(id);resolve(value);
  };
  const timer=setTimeout(()=>finish(false),timeoutMs);timer.unref?.();
  control.semanticAcknowledgements.set(id,{resolve,timer});
  return {promise,cancel:()=>finish(false)};
}

export function acknowledgeSemantic(control,id){
  const pending=control.semanticAcknowledgements?.get(id);if(!pending)return false;
  clearTimeout(pending.timer);control.semanticAcknowledgements.delete(id);pending.resolve(true);return true;
}

export async function revokeDirectControl(active, worker, claims) {
  if(claims.scope!=='revoke'||claims.wid!==worker||!Number.isSafeInteger(claims.epoch))throw Error('Invalid browser revocation');
  const control=active.get(claims.sid);
  if(!control||control.row.user_id!==claims.uid||control.row.project_id!==claims.pid||control.row.preview_mode!==claims.mode)throw Error('Revocation does not match an active browser');
  if(claims.epoch<(control.controlEpoch||0))return {revoked:false,stale:true,epoch:control.controlEpoch};
  control.controlEpoch=Math.max(control.controlEpoch||0,claims.epoch);
  for(const peer of control.clients)if(peer.masaka?.claims.scope==='input'){
    peer.masaka.claims.scope='view';
    json(peer,{type:'control-revoked'});
  }
  await releaseInput(control);
  return {revoked:true,epoch:control.controlEpoch};
}

export function createDirectServer({ active, worker, secret, port = 8787 }) {
  const http = createServer(async(req,res) => {
    if (req.url === '/health') { res.writeHead(200,{'content-type':'application/json'}); return res.end('{"ok":true}'); }
    if(req.url==='/v1/revoke'&&req.method==='POST'){
      try{
        const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
        const result=await revokeDirectControl(active,worker,verifyDirectTicket(token,secret));
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(result));
      }catch{
        res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});return res.end('{"error":"Revocation denied"}');
      }
    }
    res.writeHead(404);res.end();
  });
  const sockets = new Set(), wss = new WebSocketServer({ server:http, path:'/v1/session', maxPayload:8_000_000, perMessageDeflate:false });
  const authorize = async (socket, token) => {
    if(socket.masakaClosed)throw Error('Browser connection closed');
    const claims=verifyDirectTicket(token,secret),control=active.get(claims.sid);
    if(!['view','input'].includes(claims.scope))throw Error('Invalid browser capability scope');
    if(claims.wid!==worker||!control||control.row.user_id!==claims.uid||control.row.project_id!==claims.pid||control.row.preview_mode!==claims.mode)throw Error('Ticket does not match an active browser');
    if(claims.scope==='input'){
      if(!Number.isSafeInteger(claims.epoch)||claims.epoch<(control.controlEpoch||0))throw Error('Stale browser control ticket');
      if(claims.epoch>(control.controlEpoch||0)){
        control.controlEpoch=claims.epoch;
        for(const peer of control.clients)if(peer.masaka?.claims.scope==='input'){peer.masaka.claims.scope='view';json(peer,{type:'control-revoked'});}
        await releaseInput(control);
      }
    }
    await releaseReboundSocketInput(socket,control);
    const alreadyConnected=socket.masaka?.control===control,alreadyInput=alreadyConnected&&socket.masaka?.claims.scope==='input';
    if(claims.scope==='input'&&!alreadyInput){
      await control.beginInput?.();
      // Revocation can advance the epoch while beginInput waits for an
      // in-flight engine action. Never install the capability after that.
      if(socket.masakaClosed){control.endInput?.();throw Error('Browser connection closed');}
      if(claims.epoch!==control.controlEpoch){control.endInput?.();throw Error('Stale browser control ticket');}
      // A control ticket is followed by at least one edge round trip before
      // the first event arrives. Keep capture work paused across that gap so
      // the first click/scroll cannot land behind a newly-started screenshot.
      control.deferInputEnd?.(2000);
    }
    else if(claims.scope==='view'&&alreadyInput)await releaseInput(control);
    if(socket.masakaClosed)throw Error('Browser connection closed');
    socket.masaka?.control.clients.delete(socket);socket.masaka={claims,control};
    control.clients.add(socket);
    console.log('WPE direct authorized',claims.sid,claims.mode,claims.scope,'semanticBacklog',control.semanticBacklog?.length||0,'semanticInstalled',!!control.semanticInstalled);
    if(claims.scope==='view'&&!alreadyConnected&&control.row.preview_mode==='visual')control.forceFrame=true;
    else if(claims.scope==='view'&&!alreadyConnected&&control.semanticInstalled&&!control.semanticBacklog?.length)queueSemanticControl(control,'dash:dom-stream-start',{trigger:'viewer-connected'});
    control.wake?.();control.wake=null;
    json(socket,{type:'ready',payload:readyPayload(socket.masaka,claims.scope)});
  };
  wss.on('connection',socket=>{
    sockets.add(socket);socket.isAlive=true;socket.masakaClosed=false;socket.masakaMessages=Promise.resolve();
    socket.on('pong',()=>{socket.isAlive=true;});
    socket.on('message',(data,isBinary)=>{void enqueueSocketMessage(socket,async()=>{
      if(socket.masakaClosed)return;
      if(isBinary||data.length>128_000)return socket.close(1009,'Message too large');
      let message;try{message=JSON.parse(data.toString('utf8'));}catch{return socket.close(1007,'Invalid message');}
      try{
        if(message.type==='authorize'){await authorize(socket,message.ticket);return;}
        const state=socket.masaka;if(!state)throw Error('Authorize first');
        if(state.claims.exp<Math.floor(Date.now()/1000)){socket.close(4003,'Capability expired');return;}
        if(message.type==='deauthorize'){const heldInput=state.claims.scope==='input';state.claims.scope='view';if(heldInput)await releaseInput(state.control);return json(socket,{type:'ready',payload:readyPayload(state,'view')});}
        if(message.type==='ping')return json(socket,{type:'pong',at:Date.now(),nonce:Number.isSafeInteger(message.nonce)?message.nonce:null});
        if(message.type==='semantic-ack'){
          if(state.claims.scope!=='view'||state.control.row.preview_mode!=='semantic'||!/^[A-Za-z0-9_-]{20}$/.test(String(message.id||'')))throw Error('Invalid semantic acknowledgement');
          acknowledgeSemantic(state.control,message.id);return;
        }
        if(message.type==='semantic-control'){
          if(!CONTROL_TYPES.has(message.control_type)||!message.payload||typeof message.payload!=='object')throw Error('Invalid semantic control');
          if(state.control.row.preview_mode!=='semantic')throw Error('Session is not using Live DOM');
          const queued=queueSemanticControl(state.control,message.control_type,message.payload);
          if(!queued&&message.control_type!=='dash:dom-stream-start')throw Error('Semantic request queue is full');
          return;
        }
        if(!DIRECT_ACTION_TYPES.has(message.type)||state.claims.scope!=='input')throw Error('Input capability required');
        requireCurrentInput(state);
        if(state.claims.exp<Math.floor(Date.now()/1000))throw Error('Input capability expired');
        const seq=Number(message.seq);if(!Number.isSafeInteger(seq)||seq<0)throw Error('Invalid input sequence');
        const started=Date.now();await state.control.beginInput?.();
        try{
          requireCurrentInput(state);
          if(message.type==='input')await state.control.applyInput(message.events,state.claims.epoch);
          else if(message.type==='navigate')await state.control.navigate(message.url,state.claims.epoch);
          else if(message.type==='tab-switch')await state.control.switchTab(message.handle,state.claims.epoch);
          else if(message.type==='tab-new')await state.control.newTab(state.claims.epoch);
          else await state.control.closeTab(message.handle,state.claims.epoch);
        }
        // Compositor capture runs outside the WebDriver queue. A short idle
        // grace coalesces a pointer/keyboard burst without delaying visible
        // feedback for almost a second after every action.
        finally{state.control.deferInputEnd?.(140);}
        state.control.actions.push({session_id:state.claims.sid,user_id:state.claims.uid,project_id:state.claims.pid,seq,kind:message.type,event_count:Array.isArray(message.events)?message.events.length:1,latency_ms:Date.now()-started});
        json(socket,{type:'ack',seq,applied_at:Date.now(),processing_ms:Date.now()-started});
      }catch(error){json(socket,{type:'error',seq:Number.isSafeInteger(message?.seq)?message.seq:null,error:String(error.message).slice(0,180)});}
    });});
    socket.on('close',()=>{socket.masakaClosed=true;sockets.delete(socket);void enqueueSocketMessage(socket,async()=>{if(socket.masaka?.claims.scope==='input'){socket.masaka.claims.scope='view';await releaseInput(socket.masaka.control).catch(()=>{});}socket.masaka?.control.clients.delete(socket);}).catch(()=>{});});
    socket.on('error',()=>{});
  });
  const heartbeat=setInterval(()=>{const now=Math.floor(Date.now()/1000);for(const socket of sockets){if(socket.masaka?.claims.exp<now){socket.close(4003,'Capability expired');continue;}if(!socket.isAlive){socket.terminate();continue;}socket.isAlive=false;socket.ping();}},15000);heartbeat.unref();
  http.listen(port,'127.0.0.1');
  return {
    broadcast(control,event,payload){
      let sent=false;
      for(const socket of control.clients){
        // Preview and input use separate sockets. Keeping pixels/DOM off the
        // input socket prevents a large frame from delaying an input ACK.
        if(socket.masaka?.claims.scope!=='view')continue;
        if(socket.masaka?.claims.exp<Math.floor(Date.now()/1000)){socket.close(4003,'Capability expired');continue;}
        // A skipped viewer cannot safely consume later frame chunks or DOM
        // mutations. Disconnect it so reconnect authorization requests a full
        // frame/snapshot instead of leaving a permanently stale mirror.
        if(socket.readyState!==WebSocket.OPEN)continue;
        if(socket.bufferedAmount>8_000_000){socket.close(1013,'Preview client is too slow');continue;}
        // Pixels are latest-state data. Never build a queue of obsolete
        // frames behind a lossy/slow connection; reconnect requests a fresh
        // compositor frame. Chunks belonging to an already-started frame are
        // still kept together so the viewer never observes a partial PNG.
        if((event==='frame'||event==='frame-start')&&socket.bufferedAmount>64_000){socket.close(1013,'Preview client is too slow');continue;}
        if(payload instanceof ArrayBuffer||ArrayBuffer.isView(payload)||Buffer.isBuffer(payload)){
          const buffer=Buffer.isBuffer(payload)?payload:Buffer.from(payload.buffer||payload,payload.byteOffset||0,payload.byteLength||payload.byteLength);
          if(!json(socket,{type:'binary',event,length:buffer.length})){socket.close(1013,'Preview client is too slow');continue;}
          socket.send(buffer);sent=true;
        }else if(json(socket,{type:event,payload}))sent=true;
        else socket.close(1013,'Preview client is too slow');
      }
      return sent;
    },
    canPush(control){return [...control.clients].some(socket=>socket.masaka?.claims.scope==='view'&&socket.readyState===WebSocket.OPEN&&socket.bufferedAmount<8_000_000);},
    expectSemanticAck(control,id,timeoutMs){return expectSemanticAcknowledgement(control,id,timeoutMs);},
    async close(){clearInterval(heartbeat);for(const socket of sockets)socket.close(1001,'Worker stopping');await new Promise(resolve=>wss.close(()=>http.close(resolve)));}
  };
}

export function startQuickTunnel(onURL) {
  let child=null,stopped=false,retry=null,currentURL=null,announcedURL=null,readyTimer=null;
  const launch=()=>{
    if(stopped)return;
    child=spawn(process.env.CLOUDFLARED_BINARY||'/usr/local/bin/cloudflared',['tunnel','--no-autoupdate','--url','http://127.0.0.1:8787'],{stdio:['ignore','ignore','pipe']});
    child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{
      const match=chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match)announcedURL=match[0];
      // The hostname announcement precedes edge registration. Publishing it
      // here creates tickets which point at a route that still refuses WSS.
      if(announcedURL&&/Registered tunnel connection/i.test(chunk)&&announcedURL!==currentURL){
        clearTimeout(readyTimer);const candidate=announcedURL;
        readyTimer=setTimeout(()=>{if(!stopped&&child&&announcedURL===candidate){currentURL=candidate;onURL(currentURL);}},1500);
      }
    });
    child.once('exit',()=>{child=null;clearTimeout(readyTimer);readyTimer=null;announcedURL=null;if(currentURL){currentURL=null;onURL(null);}if(!stopped)retry=setTimeout(launch,1500);});child.once('error',()=>{});
  };
  launch();
  return ()=>{stopped=true;clearTimeout(retry);clearTimeout(readyTimer);child?.kill('SIGTERM');};
}
