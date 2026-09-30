// Disposable synthetic profiles only. Never connects to the user's Chrome/CDP.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {createClient} from '@supabase/supabase-js';
const origin='https://masaka-ai.vercel.app',url=origin+'/browser-check.html';
async function request(method,path,body){
 const args=['deeptensor','docker','exec','-i','masaka-wpe-sync-spike','curl','-sS','--max-time','35','-X',method,'-H','Content-Type:application/json'];
 if(body!==undefined)args.push('--data-binary','@-');args.push('http://127.0.0.1:9515'+path);
 const raw=await new Promise((resolve,reject)=>{const p=spawn('ssh',args),out=[],err=[];p.stdout.on('data',b=>out.push(b));p.stderr.on('data',b=>err.push(b));p.on('error',reject);p.on('close',code=>code?reject(Error('WPE transport '+Buffer.concat(err).toString())):resolve(Buffer.concat(out).toString()));p.stdin.end(body===undefined?'':JSON.stringify(body));});
 const data=JSON.parse(raw);if(data.value?.error)throw Error(data.value.error+': '+data.value.message);return data.value;
}
const browser=await chromium.launch({channel:'chrome',headless:true});let sid;
const record={id:'probe',value:'synthetic-local',revision:1};
const idbWrite=`const value=arguments[0],done=arguments[arguments.length-1];const r=indexedDB.open('masaka-sync-probe',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'id'});r.onerror=()=>done({error:'open'});r.onsuccess=()=>{const db=r.result,t=db.transaction('records','readwrite');t.objectStore('records').put(value);t.oncomplete=()=>{db.close();done(true)};t.onerror=()=>done({error:'write'})};`;
const idbRead=`const done=arguments[arguments.length-1],r=indexedDB.open('masaka-sync-probe',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'id'});r.onerror=()=>done({error:'open'});r.onsuccess=()=>{const db=r.result,q=db.transaction('records').objectStore('records').get('probe');q.onsuccess=()=>{db.close();done(q.result||null)};q.onerror=()=>done({error:'read'})};`;
const asyncLocal=(page,script,args)=>page.evaluate(({script,args})=>new Promise(resolve=>new Function(script)(...args,resolve)),{script,args});
try{
 const t=Date.now();const session=await request('POST','/session',{capabilities:{alwaysMatch:{'wpe:browserOptions':{binary:'/usr/lib/x86_64-linux-gnu/wpe-webkit-2.0/MiniBrowser',args:['--headless','--automation']}}}});sid=session.sessionId;console.log('WPE session ready',JSON.stringify({ms:Date.now()-t,capabilities:session.capabilities}));
 const wd=(method,path,body)=>request(method,'/session/'+sid+path,body);
 await wd('POST','/timeouts',{script:15000,pageLoad:25000,implicit:0});
 await wd('POST','/url',{url});
 const context=await browser.newContext(),page=await context.newPage();await page.goto(url);
 await context.addCookies([{name:'__Host-masaka-sync',value:'synthetic-local',url:origin+'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
 await page.evaluate(()=>{localStorage.setItem('sync-probe','local-v1');sessionStorage.setItem('sync-tab','local-tab');});
 await asyncLocal(page,idbWrite,[record]);
 const cookie=(await context.cookies(origin)).find(c=>c.name==='__Host-masaka-sync');
 await wd('POST','/cookie',{cookie:{name:cookie.name,value:cookie.value,path:cookie.path,secure:cookie.secure,httpOnly:cookie.httpOnly,sameSite:cookie.sameSite}});
 const state=await page.evaluate(()=>({local:localStorage.getItem('sync-probe'),session:sessionStorage.getItem('sync-tab')}));
 await wd('POST','/execute/sync',{script:'localStorage.setItem("sync-probe",arguments[0].local);sessionStorage.setItem("sync-tab",arguments[0].session);return true;',args:[state]});
 assert.equal(await wd('POST','/execute/async',{script:idbWrite,args:[record]}),true);
 const imported=await wd('GET','/cookie');const c=imported.find(c=>c.name===cookie.name);assert.equal(c.value,cookie.value);assert.equal(c.httpOnly,true);assert.equal(c.secure,true);assert.equal(c.sameSite,'Strict');
 assert.deepEqual(await wd('POST','/execute/sync',{script:'return {local:localStorage.getItem("sync-probe"),session:sessionStorage.getItem("sync-tab")};',args:[]}),state);
 assert.deepEqual(await wd('POST','/execute/async',{script:idbRead,args:[]}),record);
 console.log('PASS Chrome -> remote WPE: HttpOnly/Secure/SameSite cookie, localStorage, tab sessionStorage, IndexedDB record');
 await wd('POST','/cookie',{cookie:{name:cookie.name,value:'synthetic-remote',path:'/',httpOnly:true,secure:true,sameSite:'Strict'}});
 await wd('POST','/execute/sync',{script:'localStorage.setItem("sync-probe","remote-v2");sessionStorage.setItem("sync-tab","remote-tab");return true;',args:[]});
 const updated={...record,value:'synthetic-remote',revision:2};await wd('POST','/execute/async',{script:idbWrite,args:[updated]});
 const reverse=(await wd('GET','/cookie')).find(c=>c.name===cookie.name);
 await context.addCookies([{name:reverse.name,value:reverse.value,url:origin+'/',httpOnly:reverse.httpOnly,secure:reverse.secure,sameSite:reverse.sameSite}]);
 const back=await wd('POST','/execute/sync',{script:'return {local:localStorage.getItem("sync-probe"),session:sessionStorage.getItem("sync-tab")};',args:[]});
 await page.evaluate(s=>{localStorage.setItem('sync-probe',s.local);sessionStorage.setItem('sync-tab',s.session);},back);
 await asyncLocal(page,idbWrite,[await wd('POST','/execute/async',{script:idbRead,args:[]})]);
 assert.equal((await context.cookies(origin)).find(c=>c.name===cookie.name).value,'synthetic-remote');
 assert.deepEqual(await page.evaluate(()=>({local:localStorage.getItem('sync-probe'),session:sessionStorage.getItem('sync-tab')})),{local:'remote-v2',session:'remote-tab'});
 assert.deepEqual(await asyncLocal(page,idbRead,[]),updated);
 await wd('DELETE','/cookie/'+encodeURIComponent(cookie.name));await context.clearCookies({name:cookie.name});assert.equal((await context.cookies(origin)).filter(c=>c.name===cookie.name).length,0);
 console.log('PASS remote WPE -> Chrome: cookie rotation, localStorage, tab sessionStorage, IndexedDB update; explicit cookie deletion');
 if(process.env.TEST_ACCOUNT_EMAIL){
  const auth=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.signInWithPassword({email:process.env.TEST_ACCOUNT_EMAIL,password:process.env.TEST_ACCOUNT_PASSWORD});if(error)throw error;
  try{
   await page.evaluate(token=>localStorage.setItem('masaka-sync-test-token',token),data.session.access_token);
   const token=await page.evaluate(()=>localStorage.getItem('masaka-sync-test-token'));
   await wd('POST','/execute/sync',{script:'localStorage.setItem("masaka-sync-test-token",arguments[0]);return true;',args:[token]});
   const status=await wd('POST','/execute/async',{script:'const done=arguments[arguments.length-1];fetch(arguments[0]+"/api/overview",{headers:{Authorization:"Bearer "+localStorage.getItem("masaka-sync-test-token")}}).then(r=>done(r.status)).catch(()=>done(0));',args:[process.env.API_ORIGIN]});assert.equal(status,200);
   const reverseToken=await wd('POST','/execute/sync',{script:'return localStorage.getItem("masaka-sync-test-token");',args:[]});
   await page.evaluate(()=>localStorage.removeItem('masaka-sync-test-token'));
   const localStatus=await page.evaluate(async({token,api})=>{localStorage.setItem('masaka-sync-test-token',token);return(await fetch(api+'/api/overview',{headers:{Authorization:'Bearer '+localStorage.getItem('masaka-sync-test-token')}})).status;},{token:reverseToken,api:process.env.API_ORIGIN});assert.equal(localStatus,200);
   console.log('PASS: dedicated MASAKA test-account bearer state transferred both ways; authenticated API returned HTTP 200 in both browsers (not proof for third-party sites).');
  }finally{await auth.auth.signOut({scope:'local'});}
 }
 console.log('NOT TESTED: third-party account authentication, password manager, passkeys, device-bound credentials, partitioned cookies, arbitrary IndexedDB schemas, live concurrent state/DOM replication.');
}finally{if(sid)await request('DELETE','/session/'+sid).catch(()=>{});await browser.close();}
