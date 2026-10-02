import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {decodeProfileState} from '../../src/profile-state-bundle.mjs';

const api=process.env.API_ORIGIN||'https://masaka-backend.vercel.app';
const fixture='https://masaka-ai.vercel.app/browser-check.html';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const config=await (await fetch(api+'/api/config')).json();
const auth=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const service=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await auth.auth.signInWithPassword({email:process.env.TEST_ACCOUNT_EMAIL,password:process.env.TEST_ACCOUNT_PASSWORD});
if(login.error)throw login.error;
const token=login.data.session.access_token,user=login.data.user;

async function request(path,method='GET',body){
 const response=await fetch(`${api}/api/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
}
async function waitSession(id,predicate,limit=120){for(let index=0;index<limit;index++){const value=await request(`sessions/${id}`);if(predicate(value))return value;if(value.status==='failed')throw Error(value.error||'Session failed');await sleep(500);}throw Error('Session wait timed out');}
async function command(id,payload){const queued=await request(`sessions/${id}/commands`,'POST',payload);for(let index=0;index<120;index++){const value=await request(`commands/${queued.id}`);if(value.status==='completed')return value.result;if(value.status==='failed')throw Error(value.error);await sleep(250);}throw Error('Command timed out');}
async function evaluate(id,expression){const value=await command(id,{kind:'evaluate',expression}),result=value.evaluation;if(result?.exceptionDetails)throw Error(result.exceptionDetails.text);return result?.result?.value;}
async function launch(profileId,name){const started=performance.now(),value=await request('sessions','POST',{name,url:fixture,profile_id:profileId,max_seconds:90}),session=await waitSession(value.id,item=>item.status==='running');return {session,startupMs:Math.round(performance.now()-started)};}
async function stop(id){const started=performance.now();await request(`sessions/${id}/stop`,'POST',{}).catch(()=>{});await waitSession(id,item=>['completed','failed'].includes(item.status));return Math.round(performance.now()-started);}

const marker=`bundle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const write=`(()=>new Promise((resolve,reject)=>{localStorage.setItem('masaka-bundle-marker',${JSON.stringify(marker)});sessionStorage.setItem('masaka-session-marker',${JSON.stringify(marker)});document.cookie='masaka_bundle_cookie=${marker}; Path=/; Secure; SameSite=Strict';const request=indexedDB.open('masaka-profile-bundle-e2e',1);request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'id'});request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put({id:'probe',value:${JSON.stringify(marker)}});tx.onerror=()=>reject(tx.error);tx.oncomplete=()=>{db.close();caches.open('masaka-profile-bundle-e2e').then(cache=>cache.put('/browser-check.html?bundle-cache',new Response(${JSON.stringify(marker)}))).then(()=>resolve(true),reject);};};}))()`;
const read=`(async()=>{const indexed=await new Promise(resolve=>{const request=indexedDB.open('masaka-profile-bundle-e2e',1);request.onupgradeneeded=()=>{request.transaction.abort();resolve(null)};request.onerror=()=>resolve(null);request.onsuccess=()=>{const db=request.result;let query;try{query=db.transaction('records').objectStore('records').get('probe')}catch{db.close();resolve(null);return}query.onerror=()=>{db.close();resolve(null)};query.onsuccess=()=>{const value=query.result?.value||null;db.close();resolve(value)};};});let cached=null,cacheNames=[],cacheRequests=[];try{cacheNames=await caches.keys();const cache=await caches.open('masaka-profile-bundle-e2e');cacheRequests=(await cache.keys()).map(request=>request.url);const response=await cache.match('/browser-check.html?bundle-cache');cached=response?await response.text():null}catch{}return {local:localStorage.getItem('masaka-bundle-marker'),session:sessionStorage.getItem('masaka-session-marker'),cookie:document.cookie,indexed,cached,cacheNames,cacheRequests};})()`;

let profile,first,second;
try{
 profile=await request('profiles','POST',{name:'Encrypted full-profile E2E'});
 const firstLaunch=await launch(profile.id,'Full profile write');first=firstLaunch.session;assert.match(first.worker_id,/^deeptensor-wpe-0[12]$/);assert.equal(await evaluate(first.id,write),true);if(process.env.DEBUG_HOLD_MS)await sleep(Number(process.env.DEBUG_HOLD_MS));
 const firstStopMs=await stop(first.id);first=null;
 const {data:storedProfile,error:storedProfileError}=await service.from('browser_profiles').select('state_expires_at').eq('id',profile.id).single();if(storedProfileError)throw storedProfileError;const retentionMs=Date.parse(storedProfile.state_expires_at)-Date.now();assert.ok(retentionMs>23.9*60*60*1000&&retentionMs<=24.1*60*60*1000,'profile state expiry must be approximately 24 hours');
 let object;for(let index=0;index<20;index++){const value=await service.storage.from('browser-profiles').download(`${user.id}/${profile.id}.bundle`);if(!value.error){object=Buffer.from(await value.data.arrayBuffer());break;}await sleep(250);}assert.ok(object?.length>34,'encrypted profile bundle was not stored');assert.equal(object.includes(Buffer.from(marker)),false,'profile marker leaked into ciphertext');const decoded=decodeProfileState(object,user.id,profile.id),origin=decoded.origins.find(value=>value.origin===new URL(fixture).origin),cachedEntry=origin?.cacheStorage?.[0]?.entries?.[0],indexedRecord=origin?.indexedDB?.[0]?.stores?.[0]?.records?.[0]?.value;assert.equal(origin?.sessionStorage?.find(value=>value.name==='masaka-session-marker')?.value,marker);assert.equal(indexedRecord?.__masaka==='object'?indexedRecord.value?.value:indexedRecord?.value,marker);assert.equal(cachedEntry?.response?.body!==undefined,true,'CacheStorage was not exported');assert.equal(Buffer.from(cachedEntry.response.body,'base64').toString(),marker,`CacheStorage body export mismatch (status ${cachedEntry.response.status})`);
 const secondLaunch=await launch(profile.id,'Full profile restore');second=secondLaunch.session;const restored=await evaluate(second.id,read);assert.deepEqual({local:restored.local,session:restored.session,cookie:restored.cookie,indexed:restored.indexed,cached:restored.cached},{local:marker,session:marker,cookie:`masaka_bundle_cookie=${marker}`,indexed:marker,cached:marker},`restored state mismatch: ${JSON.stringify(restored)}`);const secondStopMs=await stop(second.id);second=null;
 console.log(JSON.stringify({status:'PASS',worker:firstLaunch.session.worker_id,restoreWorker:secondLaunch.session.worker_id,engine:'WPE WebKit',bundleBytes:object.length,firstStartupMs:firstLaunch.startupMs,firstStopAndUploadMs:firstStopMs,restoreStartupMs:secondLaunch.startupMs,secondStopAndUploadMs:secondStopMs,stateRetentionHours:Math.round(retentionMs/360000)/10,restored:['cookie','localStorage','sessionStorage','IndexedDB','CacheStorage'],plaintextAbsentFromBundle:true}));
}finally{
 if(first)await stop(first.id).catch(()=>{});if(second)await stop(second.id).catch(()=>{});if(profile)await request(`profiles/${profile.id}`,'DELETE').catch(()=>{});await auth.auth.signOut({scope:'local'});auth.realtime.disconnect();service.realtime.disconnect();
}
