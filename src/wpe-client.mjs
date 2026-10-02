import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

export class WpeClient{
	 constructor(child=null,driverURL=process.env.WPE_WEBDRIVER_URL||'http://127.0.0.1:9515',captureURL=null){
	  this.driverURL=driverURL;this.captureURL=captureURL;this.child=child||spawn(process.env.JET_WPE_BINARY||'/usr/local/bin/jet-wpe',[],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,WPE_WEBDRIVER_URL:driverURL}});this.pending=[];this.closed=false;
  const engine=this.child;this.lines=createInterface({input:engine.stdout});
  this.lines.on('line',line=>this.receive(line));
  engine.stderr?.on('data',data=>{const message=String(data).replace(/https?:\/\/\S+/g,'[url]').slice(0,300).trim();if(message)console.error('WPE engine',message);});
  engine.stdin?.on('error',error=>this.fail(error));
  engine.once('error',error=>this.fail(error));engine.once('exit',(code,signal)=>this.fail(Error(`WPE engine exited (${code??signal})`)));
 }
 receive(line){
  const pending=this.pending.shift();if(!pending)return this.fail(Error('Unexpected WPE response'));
  clearTimeout(pending.timer);
  try{const response=JSON.parse(line);if(response.ok)pending.resolve(response.value);else{const error=Error(response.error||'WPE command failed');if(pending.op==='create'&&/^Unsafe driver creation:/i.test(error.message))error.driverReusable=false;if(/^(?:Driver transport failed|Invalid driver response|Missing driver value)$/i.test(error.message))error.driverRestartRequired=true;pending.reject(error);}}
  catch{const error=Error('Invalid WPE response');error.driverRestartRequired=true;pending.reject(error);this.fail(error);}
 }
	 fail(error){if(this.closed)return;error.driverRestartRequired=true;this.closed=true;for(const pending of this.pending.splice(0)){clearTimeout(pending.timer);if(pending.op==='create')error.driverReusable=false;pending.reject(error);}}
 abort(message='WPE session deadline exceeded'){if(this.closed)return;this.fail(Error(message));this.child.kill('SIGKILL');}
 command(value,timeout=45000){
  if(this.closed){const error=Error('WPE engine is closed');error.driverRestartRequired=true;return Promise.reject(error);}
	  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{const error=Error(`WPE ${value.op} command timed out`);error.driverRestartRequired=true;if(value.op==='create')error.driverReusable=false;this.fail(error);this.child.kill('SIGKILL');},timeout);this.pending.push({resolve,reject,timer,op:value.op});this.child.stdin.write(JSON.stringify(value)+'\n',error=>{if(error)this.fail(error);});});
 }
	 async create(options={},timeout=15000){
  const supplied=Object.hasOwn(options,'downloadToken');
  if(supplied&&(typeof options.downloadToken!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(options.downloadToken)))throw Error('Invalid download token');
	  const pageLoadStrategy=options.pageLoadStrategy||'eager';if(!['none','eager','normal'].includes(pageLoadStrategy))throw Error('Invalid page-load strategy');
	  const value=await this.command({op:'create',proxy:options.proxy||null,profile_dir:options.profileDir||null,page_load_strategy:pageLoadStrategy,...(supplied?{download_token:options.downloadToken}:{})},timeout);this.sessionId=value.sessionId;return value;
 }
 navigate(url,timeout=45000){return this.command({op:'navigate',url},timeout);}
 beginNavigation(url,timeout=10000){return this.command({op:'begin_navigation',url},timeout);}
 input(events){return this.command({op:'input',events});}
 screenshot(){return this.command({op:'screenshot'});}
	 async compositorScreenshot(timeout=5000){
	  if(!this.captureURL)return this.screenshot();
	  const response=await fetch(this.captureURL+'/capture',{signal:AbortSignal.timeout(timeout)});
	  if(!response.ok)throw Error(`WPE compositor capture failed (${response.status})`);
	  const frame=Buffer.from(await response.arrayBuffer());
	  if(frame.length<1000||frame.length>4_000_000)throw Error('WPE compositor returned an invalid frame');
	  return frame.toString('base64');
	 }
 title(){return this.command({op:'title'});}
	 url(timeout=45000){return this.command({op:'url'},timeout);}
	 windowHandles(){return this.command({op:'window_handles'});}
	 currentWindow(){return this.command({op:'current_window'});}
	 switchWindow(handle){return this.command({op:'switch_window',handle});}
	 newWindow(kind='tab'){return this.command({op:'new_window',kind});}
	 closeWindow(){return this.command({op:'close_window'});}
	 documentState(timeout=5000){return this.command({op:'document_state'},timeout);}
	 visualState(timeout=5000){return this.command({op:'visual_state'},timeout);}
	 snapshot(timeout=45000){return this.command({op:'snapshot'},timeout);}
	 evaluate(expression,timeout=45000){return this.command({op:'evaluate',expression},timeout);}
	 injectSemantic(source){return this.command({op:'inject_semantic',source});}
	 drainSemantic(maxBytes=2_100_000,maxMessages=128){return this.command({op:'drain_semantic',max_bytes:maxBytes,max_messages:maxMessages});}
	 semanticControl(type,payload={}){return this.command({op:'semantic_control',type,payload});}
	 exportState(){return this.command({op:'export_state'});}
 importState(state){return this.command({op:'import_state',state});}
 release(){return this.command({op:'release'});}
	 async close(){if(this.closed)return this.cleanupOrphan();try{await this.command({op:'close'},15000);this.sessionId=null;}catch(error){try{await this.cleanupOrphan();}catch(cleanupError){throw new AggregateError([error,cleanupError],'WPE session cleanup failed');}throw error;}finally{this.closed=true;this.lines.close();this.child.stdin.end();setTimeout(()=>this.child.kill('SIGKILL'),2000).unref();}}
	 async cleanupOrphan(attempts=3){
  if(!this.sessionId)return;const id=this.sessionId;let failure;
  for(let attempt=0;attempt<attempts;attempt++)try{const response=await fetch(this.driverURL+'/session/'+encodeURIComponent(id),{method:'DELETE',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error(`WPE orphan cleanup failed (${response.status||'HTTP error'})`);if(this.sessionId===id)this.sessionId=null;return;}catch(error){failure=error;if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}
  throw failure;
 }
}
