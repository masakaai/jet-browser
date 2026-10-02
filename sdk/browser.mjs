const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const topicBytes=value=>{
  if(value instanceof ArrayBuffer)return value;
  if(ArrayBuffer.isView(value))return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);
  if(Array.isArray(value))return Uint8Array.from(value).buffer;
  if(value?.data&&Array.isArray(value.data))return Uint8Array.from(value.data).buffer;
  return null;
};

/**
 * Authenticated web/mobile SDK. It accepts a short-lived Supabase access token;
 * service keys and MASAKA API keys must never be shipped in a public client.
 */
export class MasakaBrowserClient {
  constructor({accessToken,getAccessToken,projectId,baseUrl='https://masaka-backend.vercel.app',fetchImpl=globalThis.fetch,WebSocketImpl=globalThis.WebSocket,setTimeoutImpl=globalThis.setTimeout,clearTimeoutImpl=globalThis.clearTimeout}={}){
    if(!accessToken&&!getAccessToken)throw Error('Provide accessToken or getAccessToken');
    if(!projectId)throw Error('projectId is required');
    if(typeof fetchImpl!=='function')throw Error('fetch is unavailable');
    this.accessToken=accessToken;this.getAccessToken=getAccessToken;this.projectId=projectId;
    this.baseUrl=baseUrl.replace(/\/$/,'');this.fetch=fetchImpl;this.WebSocket=WebSocketImpl;this.setTimeout=setTimeoutImpl;this.clearTimeout=clearTimeoutImpl;this.controls=new Map();
  }
  async token(){const value=this.getAccessToken?await this.getAccessToken():this.accessToken;if(!value)throw Error('Your sign-in session expired');return value;}
  async request(path,method='GET',body,{control,raw=false}={}){
    const headers={Authorization:'Bearer '+await this.token(),'X-Masaka-Project':this.projectId};
    if(body!==undefined)headers['Content-Type']='application/json';if(control)headers['X-Masaka-Control']=control;
    const response=await this.fetch(this.baseUrl+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    if(raw){if(!response.ok)throw Error(`Browser API error (${response.status})`);return response;}
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||`Browser API error (${response.status})`);return data;
  }
  create({url='https://duckduckgo.com/',profileId=null,proxyId=null,previewMode='semantic',maxSeconds=300,name='Browser session'}={}){return this.request('sessions','POST',{url,profile_id:profileId,proxy_id:proxyId,preview_mode:previewMode,max_seconds:maxSeconds,name});}
  get(id){return this.request('sessions/'+encodeURIComponent(id));}
  async stop(id){try{return await this.request('sessions/'+encodeURIComponent(id)+'/stop','POST',{});}finally{this.controls.delete(id);}}
  async waitForReady(id,{timeout=60000,signal}={}){const start=Date.now();while(Date.now()-start<timeout){if(signal?.aborted)throw signal.reason||Error('Aborted');const session=await this.get(id);if(session.status==='running')return session;if(['failed','completed'].includes(session.status))throw Error(session.error||'Session ended');await wait(900);}throw Error('Browser startup timed out');}
  async takeControl(id){const previous=this.controls.get(id);const claim=await this.request('sessions/'+encodeURIComponent(id)+'/control','POST',{mode:'human'},{control:previous});this.controls.set(id,claim.token);return claim;}
  async releaseControl(id){const token=this.controls.get(id);if(!token)return {mode:'agent'};const released=await this.request('sessions/'+encodeURIComponent(id)+'/control','DELETE',undefined,{control:token});this.controls.delete(id);return released;}
  async command(id,action,{waitForResult=true,timeout=30000}={}){const token=this.controls.get(id);if(!token)throw Error('Call takeControl() before sending human input');const command=await this.request('sessions/'+encodeURIComponent(id)+'/commands','POST',action,{control:token});return waitForResult?this.waitForCommand(command.id,{timeout}):command;}
  async waitForCommand(id,{timeout=30000}={}){const start=Date.now();while(Date.now()-start<timeout){const command=await this.request('commands/'+encodeURIComponent(id));if(command.status==='completed')return command.result;if(command.status==='failed')throw Error(command.error||'Browser command failed');await wait(120);}throw Error('Browser command is still pending');}
  input(id,events,options){return this.command(id,{kind:'input',events},options);}
  pointer(id,{phase,x,y,button=0},options){return this.input(id,[{type:'pointer',phase,x:Math.round(x),y:Math.round(y),button}],options);}
  touch(id,{phase,x,y},options){return this.pointer(id,{phase,x,y,button:0},options);}
  wheel(id,{x,y,deltaX=0,deltaY=0},options){return this.input(id,[{type:'wheel',x:Math.round(x),y:Math.round(y),delta_x:Math.round(deltaX),delta_y:Math.round(deltaY)}],options);}
  key(id,{key,down},options){return this.input(id,[{type:'key',key,down}],options);}
  text(id,text,options){return this.input(id,[{type:'text',text}],options);}
  releaseInputs(id,options){return this.input(id,[{type:'release'}],options);}
  navigate(id,url,options){return this.command(id,{kind:'navigate',url},options);}
  async listDownloads(id,{page=1,pageSize=25}={}){return this.request(`sessions/${encodeURIComponent(id)}/downloads?page=${page}&page_size=${pageSize}`);}
  download(id,downloadId){return this.request(`sessions/${encodeURIComponent(id)}/downloads?download_id=${encodeURIComponent(downloadId)}`,'GET',undefined,{raw:true});}
  /** Subscribe directly to the assigned browser worker. Returns a close handle. */
  async preview(id,{onFrame,onSemantic,onState=()=>{},onControl=()=>{},onStatus=()=>{}}={}){
    if(typeof this.WebSocket!=='function')throw Error('WebSocket is unavailable');
    const encoded=encodeURIComponent(id),session=await this.get(id),initial=await this.request(`sessions/${encoded}/ticket`,'POST',{});
    const socket=new this.WebSocket(initial.url.replace(/\/$/,'')+'/v1/session');socket.binaryType='arraybuffer';
    let closed=false,pendingBinary=null,frameChunks=null,semanticChunks=null,refreshTimer=null;
    const merge=state=>{if(!state||state.values.length!==state.total)return null;const merged=new Uint8Array(state.size);let offset=0;for(const part of state.values){if(offset+part.byteLength>merged.byteLength)return null;merged.set(part,offset);offset+=part.byteLength;}return offset===merged.byteLength?merged:null;};
    const deliverFrame=value=>{const bytes=topicBytes(value);if(bytes&&!closed)onFrame?.(new Uint8Array(bytes),session);};
    const acknowledgeSemantic=message=>{const id=message?._transport_id;if(id&&socket.readyState===this.WebSocket.OPEN)socket.send(JSON.stringify({type:'semantic-ack',id}));};
    const deliverSemantic=value=>{try{const bytes=topicBytes(value),message=JSON.parse(new TextDecoder().decode(bytes));if(!closed){onSemantic?.(message,session);acknowledgeSemantic(message);}}catch{onStatus('ERROR',Error('Invalid semantic preview message'));}};
    const renew=async()=>{if(closed)return;try{const ticket=await this.request(`sessions/${encoded}/ticket`,'POST',{});if(closed)return;socket.send(JSON.stringify({type:'authorize',ticket:ticket.ticket}));if(!closed)schedule(ticket);}catch(error){if(closed)return;onStatus('ERROR',error);refreshTimer=this.setTimeout(renew,3000);}};
    const schedule=ticket=>{this.clearTimeout(refreshTimer);const expires=Date.parse(ticket.expires_at),delay=Number.isFinite(expires)?Math.max(5000,expires-Date.now()-20000):40000;refreshTimer=this.setTimeout(renew,delay);};
    const ready=new Promise((resolve,reject)=>{const timer=this.setTimeout(()=>reject(Error('Direct preview connection timed out')),15000);
      socket.onopen=()=>{onStatus('CONNECTING');socket.send(JSON.stringify({type:'authorize',ticket:initial.ticket}));};
      socket.onmessage=event=>{if(closed)return;if(typeof event.data!=='string'){
        const type=pendingBinary;pendingBinary=null;const bytes=topicBytes(event.data);if(!type||!bytes)return;
        if(type==='frame')deliverFrame(bytes);
        else if(type==='frame-chunk'&&frameChunks){frameChunks.values.push(new Uint8Array(bytes));const merged=merge(frameChunks);if(merged){frameChunks=null;deliverFrame(merged);}}
        else if(type==='semantic-chunk'&&semanticChunks){semanticChunks.values.push(new Uint8Array(bytes));const merged=merge(semanticChunks);if(merged){semanticChunks=null;deliverSemantic(merged);}}
        return;
      }
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==='binary'){pendingBinary=message.event;return;}
      if(message.type==='ready'){this.clearTimeout(timer);onStatus('SUBSCRIBED');resolve(message.payload);return;}
      if(message.type==='frame-start')frameChunks={...message.payload,values:[]};
      else if(message.type==='semantic-start')semanticChunks={...message.payload,values:[]};
      else if(message.type==='semantic'){onSemantic?.(message.payload,session);acknowledgeSemantic(message.payload);}
      else if(message.type==='state')onState(message.payload);
      else if(message.type==='control-revoked')onControl({mode:'view',revoked:true});
      else if(message.type==='error'){const error=Error(message.error||'Direct preview failed');onStatus('ERROR',error);reject(error);}
    };
      socket.onerror=()=>{this.clearTimeout(timer);reject(Error('Direct preview connection failed'));};
      socket.onclose=()=>{const wasClosed=closed;closed=true;this.clearTimeout(timer);this.clearTimeout(refreshTimer);if(!wasClosed){onStatus('CLOSED');reject(Error('Direct preview connection closed'));}};
    });
    try{await ready;}catch(error){closed=true;this.clearTimeout(refreshTimer);socket.close(1000,'Preview initialization failed');throw error;}schedule(initial);
    return {session,socket,close:async()=>{if(closed)return;closed=true;this.clearTimeout(refreshTimer);socket.close(1000,'Preview closed');}};
  }
}
