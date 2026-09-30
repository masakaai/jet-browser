/** Minimal fetch-based SDK. Use API keys in trusted code, never in a public bundle. */
export class JetBrowser {
  constructor({apiKey,baseUrl='https://masaka-backend.vercel.app'}){this.apiKey=apiKey;this.baseUrl=baseUrl.replace(/\/$/,'');}
  async request(path,method='GET',body){const r=await fetch(this.baseUrl+'/api/'+path,{method,headers:{Authorization:'Bearer '+this.apiKey,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Browser API error');return data;}
  create({url,profileId=null,maxSeconds=300,name='Agent session'}){return this.request('sessions','POST',{url,profile_id:profileId,max_seconds:maxSeconds,name});}
  get(id){return this.request('sessions/'+encodeURIComponent(id));}
  stop(id){return this.request('sessions/'+encodeURIComponent(id)+'/stop','POST',{});}
  async waitForReady(id,{timeout=60000}={}){const start=Date.now();while(Date.now()-start<timeout){const s=await this.get(id);if(s.status==='running')return s;if(['failed','completed'].includes(s.status))throw Error(s.error||'Session ended');await new Promise(r=>setTimeout(r,1200));}throw Error('Browser startup timed out');}
  async action(id,action,{timeout=30000}={}){const command=await this.request('sessions/'+encodeURIComponent(id)+'/commands','POST',action);const start=Date.now();while(Date.now()-start<timeout){const c=await this.request('commands/'+command.id);if(c.status==='completed')return c.result;if(c.status==='failed')throw Error(c.error);await new Promise(r=>setTimeout(r,650));}throw Error('Command is still pending; inspect before retrying');}
  navigate(id,url){return this.action(id,{kind:'navigate',url});}
  click(id,x,y){return this.action(id,{kind:'click',x,y});}
  type(id,text){return this.action(id,{kind:'type',text});}
  press(id,key){return this.action(id,{kind:'key',key});}
  scroll(id,delta){return this.action(id,{kind:'scroll',delta});}
}
