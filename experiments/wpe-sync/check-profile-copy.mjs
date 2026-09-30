import assert from 'node:assert/strict';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const root=await mkdtemp(join(tmpdir(),'masaka-profile-copy-'));
const url='https://masaka-ai.vercel.app/browser-check.html',origin=new URL(url).origin;
let context;
try{
 context=await chromium.launchPersistentContext(join(root,'source'),{channel:'chrome',headless:true});
 const page=await context.newPage();await page.goto(url);
 await context.addCookies([{name:'__Host-copy-probe',value:'synthetic-only',url:origin,httpOnly:true,secure:true,sameSite:'Strict',expires:Date.now()/1000+3600}]);
 await page.evaluate(async()=>{
  localStorage.setItem('copy-probe','persistent');sessionStorage.setItem('copy-probe','ephemeral');window.copyProbe='live-memory';
  const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign']);
  await new Promise((resolve,reject)=>{const r=indexedDB.open('masaka-copy-probe',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>{const db=r.result,t=db.transaction('keys','readwrite');t.objectStore('keys').put(key,'key');t.oncomplete=()=>{db.close();resolve()};t.onerror=reject};r.onerror=reject});
 });
 await context.close();context=null;
 // Clone only a stopped, disposable profile. Never touches the user's profile.
 await cp(join(root,'source'),join(root,'copy'),{recursive:true});
 context=await chromium.launchPersistentContext(join(root,'copy'),{channel:'chrome',headless:true});
 const restored=await context.newPage();await restored.goto(url);
 assert.equal((await context.cookies(origin)).find(c=>c.name==='__Host-copy-probe')?.value,'synthetic-only');
 const state=await restored.evaluate(async()=>{
  const key=await new Promise((resolve,reject)=>{const r=indexedDB.open('masaka-copy-probe',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('keys').objectStore('keys').get('key');q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=reject};r.onerror=reject});
  return {local:localStorage.getItem('copy-probe'),session:sessionStorage.getItem('copy-probe'),heap:window.copyProbe??null,nonExtractable:key.extractable===false,signatureBytes:(await crypto.subtle.sign('HMAC',key,new Uint8Array([1,2,3]))).byteLength};
 });
 assert.equal(state.local,'persistent');assert.equal(state.nonExtractable,true);assert.equal(state.signatureBytes,32);
 assert.equal(state.session,null);assert.equal(state.heap,null);
 console.log(JSON.stringify({sameHostColdProfileCopy:'PASS',persistentHttpOnlyCookie:true,...state}));
 console.log('Scope: same Chrome + same macOS identity; not proof of cross-machine/keychain/passkey portability. Fresh tabs do not recover previous tab sessionStorage or JS heap.');
}finally{await context?.close();await rm(root,{recursive:true,force:true});}
