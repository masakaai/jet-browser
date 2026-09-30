import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { startProxy, webURL, resolvePublic } from './network.mjs';
import { seal, unseal } from './vault.mjs';
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const worker=process.env.WORKER_ID||'deeptensor-01',capacity=2;
const active=new Map();let stopping=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function query(p){const {data,error}=await p;if(error)throw Error(error.message);return data;}
const rpc=(n,p)=>query(db.rpc(n,p));
async function publish(row,page){
  const buffer=await page.screenshot({type:'jpeg',quality:65,timeout:8000});
  const path=`${row.user_id}/${row.id}/latest.jpg`;
  await query(db.storage.from('browser-previews').upload(path,buffer,{contentType:'image/jpeg',upsert:true,cacheControl:'0'}));
  await query(db.from('browser_sessions').update({preview_path:path,preview_at:new Date().toISOString(),title:(await page.title()).slice(0,200),url:page.url()}).eq('id',row.id).eq('worker_id',worker).eq('status','running'));
}
async function runSession(row){
  let browser,context,page,proxy,lastPreview=0,lastHeartbeat=0,terminal='completed',failure=null;
  let leaseDeadline=Date.now()+30000;
  const control={stop:false};active.set(row.id,control);
  try {
    const destination=webURL(row.url);await resolvePublic(destination.hostname);
    proxy=await startProxy();
    browser=await chromium.launch({headless:true,chromiumSandbox:true,proxy:{server:proxy.url},env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8'},args:['--proxy-bypass-list=<-loopback>','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
    let storageState;
    if(row.profile_id){const profile=await query(db.from('browser_profiles').select('encrypted_state').eq('id',row.profile_id).eq('user_id',row.user_id).maybeSingle());if(profile?.encrypted_state)storageState=unseal(profile.encrypted_state,row.user_id);}
    context=await browser.newContext({viewport:{width:1280,height:800},storageState,serviceWorkers:'block',acceptDownloads:false});
    context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(20000);
    await context.route('**/*',async route=>{try{const url=webURL(route.request().url());await resolvePublic(url.hostname);await route.continue();}catch{await route.abort('blockedbyclient');}});
    context.on('page',p=>{p.on('dialog',d=>d.dismiss().catch(()=>{}));if(page)p.close().catch(()=>{});});
    page=await context.newPage();
    await page.goto(row.url,{waitUntil:'domcontentloaded'});
    if(!(await rpc('start_session',{p_session:row.id,p_worker:worker})))throw Error('Session was canceled before startup');
    const started=Date.now();leaseDeadline=started+30000;
    while(!stopping&&!control.stop&&Date.now()-started<row.max_seconds*1000){
      if(Date.now()>leaseDeadline)throw Error('Database lease lost');
      if(Date.now()-lastHeartbeat>5000){
        const updated=await query(db.from('browser_sessions').update({heartbeat_at:new Date().toISOString()}).eq('id',row.id).eq('worker_id',worker).eq('status','running').select('id'));
        if(!updated.length)break;lastHeartbeat=Date.now();leaseDeadline=Date.now()+30000;
      }
      const [command]=await rpc('claim_command',{p_session:row.id});
      if(command){
        try{
          const payload=command.payload;
          if(command.kind==='stop'){control.stop=true;}
          else if(command.kind==='navigate'){const u=webURL(payload.url);await resolvePublic(u.hostname);await page.goto(u.href,{waitUntil:'domcontentloaded'});}
          else if(command.kind==='click')await page.mouse.click(payload.x,payload.y);
          else if(command.kind==='type')await page.keyboard.insertText(payload.text);
          else if(command.kind==='key')await page.keyboard.press(payload.key);
          else if(command.kind==='scroll')await page.mouse.wheel(0,payload.delta);
          else if(command.kind==='credential'){
            const credential=await query(db.from('credentials').select('*').eq('id',payload.credential_id).eq('user_id',row.user_id).single());
            const current=new URL(page.url());if(current.protocol!=='https:'||current.hostname!==credential.hostname)throw Error('Credential is restricted to its HTTPS hostname');
            await page.keyboard.insertText(unseal(credential.encrypted_value,row.user_id));
          }else throw Error('Unsupported browser command');
          await query(db.from('browser_commands').update({status:'completed',payload:{},result:{url:page.url()},finished_at:new Date().toISOString()}).eq('id',command.id));
        }catch{
          await query(db.from('browser_commands').update({status:'failed',payload:{},error:'Action failed or destination blocked. Check the page and retry.',finished_at:new Date().toISOString()}).eq('id',command.id));
        }
        lastPreview=0;
      }
      if(!control.stop&&Date.now()-lastPreview>2000){await publish(row,page);lastPreview=Date.now();}
      await sleep(350);
    }
  }catch(error){terminal='failed';failure='Browser could not complete the session. The unused reservation has been released.';console.error('Session failure',row.id,error.message.replace(/https?:\/\/\S+/g,'[url]').slice(0,250));}
  finally{
    if(context&&row.profile_id){try{const state=await context.storageState({indexedDB:true});await query(db.from('browser_profiles').update({encrypted_state:seal(state,row.user_id),updated_at:new Date().toISOString()}).eq('id',row.profile_id).eq('user_id',row.user_id));}catch{console.error('Profile save failed',row.id);}}
    await browser?.close().catch(()=>{});proxy?.close();
    for(let attempt=0;attempt<3;attempt++){try{await rpc('finish_session',{p_session:row.id,p_status:terminal,p_error:failure});break;}catch{await sleep(1000);}}
    active.delete(row.id);
  }
}
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
console.log('jet-browser worker starting',worker);
while(!stopping){
  try{
    await query(db.from('workers').upsert({id:worker,heartbeat_at:new Date().toISOString(),capacity,active_sessions:active.size,version:'0.1.0'}));
    await rpc('expire_sessions',{});
    if(active.size<capacity){const [row]=await rpc('claim_session',{p_worker:worker});if(row)void runSession(row);}
  }catch{console.error('Worker control-plane connection failed');}
  await sleep(2000);
}
while(active.size)await sleep(500);
await db.from('workers').delete().eq('id',worker);
