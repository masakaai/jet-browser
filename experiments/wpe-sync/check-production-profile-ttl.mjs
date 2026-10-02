import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {decodeProfileState} from '../../src/profile-state-bundle.mjs';

const api=process.env.API_ORIGIN||'https://masaka-backend.vercel.app';
const fixture='https://masaka-ai.vercel.app/browser-check.html';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const config=await (await fetch(`${api}/api/config`)).json();
const auth=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const service=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await auth.auth.signInWithPassword({email:process.env.TEST_ACCOUNT_EMAIL,password:process.env.TEST_ACCOUNT_PASSWORD});
if(login.error)throw login.error;
const token=login.data.session.access_token,user=login.data.user;
async function request(path,method='GET',body){const response=await fetch(`${api}/api/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)}),data=await response.json();if(!response.ok)throw Error(data.error||`Request failed (${response.status})`);return data;}
async function waitSession(id,predicate){for(let index=0;index<150;index++){const value=await request(`sessions/${id}`);if(predicate(value))return value;if(value.status==='failed')throw Error(value.error||'Session failed');await sleep(400);}throw Error('Session wait timed out');}
async function command(id,payload){const queued=await request(`sessions/${id}/commands`,'POST',payload);for(let index=0;index<150;index++){const value=await request(`commands/${queued.id}`);if(value.status==='completed')return value.result;if(value.status==='failed')throw Error(value.error||'Command failed');await sleep(150);}throw Error('Command timed out');}
async function evaluate(id,expression){const value=await command(id,{kind:'evaluate',expression}),result=value.evaluation;if(result?.exceptionDetails)throw Error(result.exceptionDetails.text);return result?.result?.value;}
async function launch(profileId,name){const created=await request('sessions','POST',{name,url:fixture,profile_id:profileId,max_seconds:90});return waitSession(created.id,value=>value.status==='running');}
async function stop(id){await request(`sessions/${id}/stop`,'POST',{}).catch(()=>{});return waitSession(id,value=>['completed','failed'].includes(value.status));}

const marker=`login-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let profile,writer,reader,writerWorker,readerWorker;
try{
 profile=await request('profiles','POST',{name:'24 hour login state E2E'});
 writer=await launch(profile.id,'Profile TTL write');writerWorker=writer.worker_id;
 console.log(JSON.stringify({syncSnapshot:await command(writer.id,{kind:'snapshot'})}));
 const probe=await evaluate(writer.id,`(()=>{const check=fn=>{try{return {ok:true,value:fn()}}catch(error){return {ok:false,name:error?.name,message:error?.message}}};return {href:location.href,origin:location.origin,localRead:check(()=>localStorage.getItem('masaka-login-marker')),localWrite:check(()=>{localStorage.setItem('masaka-login-probe','1');return localStorage.getItem('masaka-login-probe')}),sessionRead:check(()=>sessionStorage.getItem('masaka-login-marker')),cookieRead:check(()=>document.cookie),cookieWrite:check(()=>{document.cookie='masaka_login_probe=1; Path=/; Secure; SameSite=Strict';return document.cookie}),indexedDB:check(()=>typeof indexedDB),caches:check(()=>typeof caches)};})()`);console.log(JSON.stringify({storageProbe:probe}));
 const written=await evaluate(writer.id,`(()=>{localStorage.setItem('masaka-login-marker',${JSON.stringify(marker)});document.cookie='masaka_login_marker=${marker}; Path=/; Secure; SameSite=Strict';return {local:localStorage.getItem('masaka-login-marker'),cookie:document.cookie};})()`);assert.equal(written.local,marker);assert.match(written.cookie,new RegExp(`(?:^|; )masaka_login_marker=${marker}(?:;|$)`));
 await stop(writer.id);writer=null;
 const {data:stored,error}=await service.from('browser_profiles').select('state_expires_at').eq('id',profile.id).single();if(error)throw error;
 const retentionMs=Date.parse(stored.state_expires_at)-Date.now();assert.ok(retentionMs>23.9*60*60*1000&&retentionMs<=24.1*60*60*1000);
 const downloaded=await service.storage.from('browser-profiles').download(`${user.id}/${profile.id}.bundle`);if(downloaded.error)throw downloaded.error;const decoded=decodeProfileState(Buffer.from(await downloaded.data.arrayBuffer()),user.id,profile.id);console.log(JSON.stringify({capturedCookies:decoded.cookies.map(({name,domain,path,secure,httpOnly,sameSite})=>({name,domain,path,secure,httpOnly,sameSite})),capturedOrigins:decoded.origins.map(({origin,localStorage})=>({origin,localStorage:localStorage.map(({name})=>name)}))}));
 reader=await launch(profile.id,'Profile TTL restore');readerWorker=reader.worker_id;
 const restored=await evaluate(reader.id,"({local:localStorage.getItem('masaka-login-marker'),cookie:document.cookie})");
 assert.equal(restored.local,marker);assert.match(restored.cookie,new RegExp(`(?:^|; )masaka_login_marker=${marker}(?:;|$)`));
 await stop(reader.id);reader=null;
 console.log(JSON.stringify({status:'PASS',worker:writerWorker,restoreWorker:readerWorker,stateRetentionHours:Math.round(retentionMs/360000)/10,restored:['cookie','localStorage']}));
}finally{
 if(writer)await stop(writer.id).catch(()=>{});if(reader)await stop(reader.id).catch(()=>{});if(profile)await request(`profiles/${profile.id}`,'DELETE').catch(()=>{});await auth.auth.signOut({scope:'local'});auth.realtime.disconnect();service.realtime.disconnect();
}
