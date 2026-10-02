/** Minimal fetch-based SDK. Use API keys in trusted code, never in a public bundle. */
export class JetBrowser {
  constructor({apiKey,baseUrl='https://masaka-backend.vercel.app'}){this.apiKey=apiKey;this.baseUrl=baseUrl.replace(/\/$/,'');this.controls=new Map();this.acquisitions=new Map();}
  async request(path,method='GET',body,{control}={}){const headers={Authorization:'Bearer '+this.apiKey,'Content-Type':'application/json'};if(control)headers['X-Masaka-Control']=control;const r=await fetch(this.baseUrl+'/api/'+path,{method,headers,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Browser API error');return data;}
  create({url='https://duckduckgo.com/',profileId=null,maxSeconds=300,name='Agent session'}={}){return this.request('sessions','POST',{url,profile_id:profileId,max_seconds:maxSeconds,name});}
  get(id){return this.request('sessions/'+encodeURIComponent(id));}
  async stop(id){try{return await this.request('sessions/'+encodeURIComponent(id)+'/stop','POST',{});}finally{this.controls.delete(id);this.acquisitions.delete(id);}}
  acquire(id,{previousToken=this.controls.get(id)}={}){if(this.acquisitions.has(id))return this.acquisitions.get(id);let pending;pending=this.request('sessions/'+encodeURIComponent(id)+'/control','POST',{mode:'agent'},{control:previousToken}).then(claim=>{if(this.acquisitions.get(id)===pending)this.controls.set(id,claim.token);return claim;}).finally(()=>{if(this.acquisitions.get(id)===pending)this.acquisitions.delete(id);});this.acquisitions.set(id,pending);return pending;}
  setControlToken(id,token){this.acquisitions.delete(id);if(token)this.controls.set(id,token);else this.controls.delete(id);return this;}
  async waitForReady(id,{timeout=60000}={}){const start=Date.now();while(Date.now()-start<timeout){const s=await this.get(id);if(s.status==='running')return s;if(['failed','completed'].includes(s.status))throw Error(s.error||'Session ended');await new Promise(r=>setTimeout(r,1200));}throw Error('Browser startup timed out');}
  async action(id,action,{timeout=30000}={}){if(!this.controls.has(id))await this.acquire(id);const command=await this.request('sessions/'+encodeURIComponent(id)+'/commands','POST',action,{control:this.controls.get(id)});const start=Date.now();while(Date.now()-start<timeout){const c=await this.request('commands/'+command.id);if(c.status==='completed')return c.result;if(c.status==='failed')throw Error(c.error);await new Promise(r=>setTimeout(r,650));}throw Error('Command is still pending; inspect before retrying');}
  navigate(id,url){return this.action(id,{kind:'navigate',url});}
  click(id,x,y){return this.action(id,{kind:'click',x,y});}
  type(id,text){return this.action(id,{kind:'type',text});}
  press(id,key){return this.action(id,{kind:'key',key});}
  scroll(id,delta){return this.action(id,{kind:'scroll',delta});}
  evaluate(id,expression){return this.action(id,{kind:'evaluate',expression});}
  snapshot(id){return this.action(id,{kind:'snapshot'});}
}

// Product-facing name; JetBrowser remains available for existing integrations.
export { JetBrowser as MasakaBrowser };
