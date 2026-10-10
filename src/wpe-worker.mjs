import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {isUniformPng} from './png-frame.mjs';
import {WpeClient} from './wpe-client.mjs';
import {startProxy,webURL,resolvePublic} from './network.mjs';
import {seal,unseal} from './vault.mjs';
import {mergeWpeState,normalizeProfileState,overlayNewerProfileSummary,profileOriginNeedsRestore,profileStateForRestore,shouldApplyWpeState} from './wpe-profile-state.mjs';
import {decodeProfileState,encodeProfileState} from './profile-state-bundle.mjs';
import {createSerialExecutor} from './serial.mjs';
import {startDownloadRuntime} from './download-runtime.mjs';
import {DownloadLoop} from './download-loop.mjs';
import {createLeaseRenewer} from './session-lease.mjs';
import {CONTROL_TYPES,normalizeSemanticBatch,prepareSemanticPreview,semanticEnvelope,semanticInjectionSource,semanticLimits,waitForSemanticPageReady} from './semantic-preview.mjs';
import {createDirectServer,startQuickTunnel} from './direct-server.mjs';
import {serializeSnapshot} from './snapshot.mjs';
import {beginNavigationWithWait,createNavigatedEngine} from './engine-start.mjs';
import {keyEvents} from './key-events.mjs';
import {isFatalEngineFailure} from './engine-failure.mjs';
import {commandEpoch,fencedLookup} from './control-command.mjs';
import {applyPortableProfile,replayPortableCache} from './profile-restore.mjs';
import {nextProfileExpiry,profileStateExpired} from './profile-retention.mjs';
import {readHostResources} from './autoscale-resources.mjs';
import {browserRegion} from './region.mjs';
import {dragInputEvents} from './drag-input.mjs';

const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})}});
const worker=process.env.WORKER_ID||'deeptensor-wpe-01',region=browserRegion(process.env.MASAKA_BROWSER_REGION),workerVersion=process.env.MASAKA_WORKER_VERSION||'0.7.0',workerStartedAt=new Date().toISOString(),driverURLs=(process.env.WPE_WEBDRIVER_URLS||'http://127.0.0.1:9515,http://127.0.0.1:9516').split(',').map(value=>value.trim()).filter(Boolean),captureURLs=(process.env.WPE_CAPTURE_URLS||'http://127.0.0.1:9615,http://127.0.0.1:9616').split(',').map(value=>value.trim()).filter(Boolean),capacity=Math.min(Number(process.env.WORKER_CAPACITY||2),driverURLs.length,captureURLs.length);
const active=new Map(),freeDrivers=[...driverURLs];let stopping=false,restartRequested=false,draining=false,claimInFlight=false,drainAcknowledged=false;
const sharedDirectRouter=process.env.MASAKA_SHARED_DIRECT_ROUTER==='1';
const profileBucket=process.env.PROFILE_BUCKET||'browser-profiles';
const downloadsEnabled=process.env.MASAKA_ENABLE_NATIVE_DOWNLOADS==='1';
if(downloadsEnabled)throw Error('Native downloads are not packaged in this worker image');
const semanticEnabled=process.env.MASAKA_SEMANTIC_PREVIEW!=='0';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function query(request){const {data,error}=await request;if(error)throw Error(error.message);return data;}
const rpc=(name,parameters)=>query(db.rpc(name,parameters));
const missingObject=error=>/not found|does not exist|404/i.test(`${error?.message||''} ${error?.statusCode||''}`);
async function downloadProfileObject(object){let result;for(let attempt=0;attempt<3;attempt++){result=await db.storage.from(profileBucket).download(object);if(!result.error||missingObject(result.error))return result;if(attempt<2)await sleep(500*(attempt+1));}return result;}
async function uploadProfileObject(object,bundle){let result;for(let attempt=0;attempt<3;attempt++){result=await db.storage.from(profileBucket).upload(object,bundle,{contentType:'application/octet-stream',upsert:true});if(!result.error)return result;if(attempt<2)await sleep(500*(attempt+1));}return result;}
async function removeProfileObject(object){let result;for(let attempt=0;attempt<3;attempt++){result=await db.storage.from(profileBucket).remove([object]);if(!result.error||missingObject(result.error))return result;if(attempt<2)await sleep(500*(attempt+1));}return result;}
const ticketSecret=process.env.DATA_PLANE_TICKET_SECRET||process.env.VAULT_ENCRYPTION_KEY;
if(!ticketSecret||ticketSecret.length<32)throw Error('The data-plane ticket secret must contain at least 32 characters');
const dataPlane=createDirectServer({active,worker,secret:ticketSecret,metricsToken:process.env.MASAKA_METRICS_TOKEN||'',host:sharedDirectRouter?'0.0.0.0':'127.0.0.1'});
let directURL=null;
const stopTunnel=sharedDirectRouter?()=>{}:startQuickTunnel(url=>{directURL=url;void db.from('workers').update({direct_url:url,direct_updated_at:new Date().toISOString()}).eq('id',worker);});
const profileObject=row=>`${row.user_id}/${row.profile_id}.bundle`;
async function loadProfile(row){
 if(!row.profile_id)return null;
 const profile=await query(db.from('browser_profiles').select('encrypted_state,state_expires_at').eq('id',row.profile_id).eq('user_id',row.user_id).eq('project_id',row.project_id).single());
 if(profileStateExpired(profile.state_expires_at)){
  const removed=await removeProfileObject(profileObject(row));
  if(removed.error&&!missingObject(removed.error))throw Error('Expired profile state could not be removed');
  await query(db.from('browser_profiles').update({encrypted_state:null,state_expires_at:null,updated_at:new Date().toISOString()}).eq('id',row.profile_id).eq('user_id',row.user_id).eq('project_id',row.project_id));
  return normalizeProfileState();
 }
 const fallback=profile.encrypted_state?normalizeProfileState(unseal(profile.encrypted_state,row.user_id)):normalizeProfileState(),download=await downloadProfileObject(profileObject(row));
 if(download.error){if(!missingObject(download.error))throw Error('Profile storage is temporarily unavailable');return fallback;}
 const bundle=normalizeProfileState(decodeProfileState(Buffer.from(await download.data.arrayBuffer()),row.user_id,row.profile_id));
 // Supabase Storage may briefly serve the previous object after an upsert.
 // The database summary commits after that upload and carries monotonic
 // revisions, so use its newer cookie/localStorage layer as the auth fence.
 return overlayNewerProfileSummary(bundle,fallback);
}
async function captureProfile(engine,state,revision){
 if(!state)return state;const url=await engine.url();if(!['http:','https:'].includes(new URL(url).protocol))return state;return mergeWpeState(state,url,await engine.exportState(),revision);
}
async function persistProfile(row,state){if(!row.profile_id||!state)return;const bundle=encodeProfileState(state,row.user_id,row.profile_id),uploaded=await uploadProfileObject(profileObject(row),bundle);if(uploaded.error)throw Error('Profile storage is temporarily unavailable');const summary={nativeRevision:state.nativeRevision,cookieRevision:state.cookieRevision,cookies:state.cookies,cookieDeletions:state.cookieDeletions||[],origins:state.origins.map(origin=>({origin:origin.origin,revision:origin.revision,localStorage:origin.localStorage||[]}))},now=Date.now();await query(db.from('browser_profiles').update({encrypted_state:seal(summary,row.user_id),state_expires_at:nextProfileExpiry(now),updated_at:new Date(now).toISOString()}).eq('id',row.profile_id).eq('user_id',row.user_id).eq('project_id',row.project_id));}
async function openStream(row,control){
 return {control};
}
const streamCanPush=channel=>Boolean(channel?.control&&dataPlane.canPush(channel.control));
async function realtimeSend(channel,event,payload){
 return streamCanPush(channel)&&dataPlane.broadcast(channel.control,event,payload);
}
async function publish(engine,channel,previousHash,previousState,force=false,streamReady=true,metadata={}){
 if(!streamReady||!streamCanPush(channel))return {hash:previousHash,state:previousState,bytes:0,delivered:false,changed:false};
 const encoded=await engine.compositorScreenshot(),title=String(metadata.title||''),url=String(metadata.url||'');const buffer=Buffer.from(encoded,'base64');if(buffer.length>4_000_000)throw Error('Preview frame exceeds transport limit');
 // A newly-mapped WPE surface initially paints as a tiny, uniform compositor
 // PNG. Keep the branded loader visible until the first real page paint.
 if(buffer.length<10_000&&url!=='about:blank'&&isUniformPng(buffer))return {hash:previousHash,state:previousState,bytes:buffer.length,delivered:false,changed:false};
 const hash=createHash('sha256').update(buffer).digest('base64url'),state=`${title}\n${url}`;
 if(!streamCanPush(channel))return {hash:previousHash,state:previousState,bytes:0,delivered:false,changed:false};
 if((force||state!==previousState)&&!await realtimeSend(channel,'state',{title:String(title).slice(0,200),url:String(url),at:new Date().toISOString()}))return {hash:previousHash,state:previousState,bytes:buffer.length,delivered:false,changed:false};
 const changed=hash!==previousHash;
 if(force||changed){
  // Stay comfortably below the smallest supported Realtime Broadcast payload
  // after protocol framing. Large PNGs are reassembled only in viewer memory.
  const chunkSize=180_000,total=Math.ceil(buffer.length/chunkSize);if(total>1&&!await realtimeSend(channel,'frame-start',{id:hash.slice(0,16),total,size:buffer.length}))return {hash:previousHash,state:previousState,bytes:buffer.length,delivered:false,changed:false};
  for(let index=0;index<total;index++){const chunk=buffer.subarray(index*chunkSize,Math.min(buffer.length,(index+1)*chunkSize)),payload=chunk.buffer.slice(chunk.byteOffset,chunk.byteOffset+chunk.byteLength);if(!await realtimeSend(channel,total===1?'frame':'frame-chunk',payload))return {hash:previousHash,state:previousState,bytes:buffer.length,delivered:false,changed:false};}
 }
 return {hash,state,title:String(title),url:String(url),bytes:buffer.length,delivered:true,changed};
}
async function publishSemantic(channel,message){
 if(!streamCanPush(channel))return false;
 const {id}=semanticEnvelope(message),reliable=message.type==='ext:dom-snapshot',receipt=reliable?dataPlane.expectSemanticAck(channel.control,id,8000):null;
 // Direct WSS accepts the bounded 2 MB semantic envelope as one ordered text
 // message. This avoids the fragile header/binary pairing used by the former
 // chunk path; a full snapshot remains queued until a viewer confirms parse.
 const delivered=await realtimeSend(channel,'semantic',{type:message.type,payload:message.payload,...(reliable?{_transport_id:id}:{})});
 if(!delivered){receipt?.cancel();return false;}
 return receipt?receipt.promise:true;
}
async function installSemantic(engine,channel,control){
 if(!semanticEnabled||control.row.preview_mode!=='semantic')return false;
 try{
  await waitForSemanticPageReady(engine);
  control.semanticBacklog=[];
  const result=await engine.injectSemantic(semanticInjectionSource());
  control.semanticInstalled=result?.installed===true;
  control.semanticGeneration=Number(result?.generation)||0;
  if(control.semanticInstalled)await realtimeSend(channel,'preview-mode',{mode:'semantic',generation:control.semanticGeneration});
  return control.semanticInstalled;
 }catch(error){
  control.semanticInstalled=false;
  console.error('WPE semantic preview unavailable',String(error.message).slice(0,180));
  const failure=Error('Live DOM initialization failed',{cause:error});
  if(error.driverRestartRequired)failure.driverRestartRequired=true;
  if(error.driverReusable===false)failure.driverReusable=false;
  throw failure;
 }
}
async function primeSemantic(engine,control){
 const prepared=await prepareSemanticPreview(engine);
 control.semanticGeneration=prepared.generation;
 control.semanticBacklog=prepared.messages;
 console.log('WPE semantic primed',control.row.id,'generation',prepared.generation,'messages',prepared.messages.map(message=>message.type).join(','));
 return prepared;
}
function requestSemanticResync(control,trigger,details={}){
 if(control.semanticPriming||control.semanticBacklog.some(message=>message.type==='ext:dom-snapshot')||control.semanticControls.some(request=>request.type==='dash:dom-stream-start'))return;
 control.semanticControls.unshift({type:'dash:dom-stream-start',payload:{trigger,...details}});
}
async function drainSemantic(engine,channel,control){
 if(!control.semanticInstalled||!streamCanPush(channel))return null;
 let observedMetadata=null;
 while(control.semanticBacklog.length){
  const message=control.semanticBacklog[0];
  if(message.type==='ext:dom-snapshot'&&typeof message.payload?.url==='string')observedMetadata={url:message.payload.url,title:String(message.payload?.title||'')};
  if(!await publishSemantic(channel,message)){
   requestSemanticResync(control,'semantic-backlog-delivery-failed');
   await realtimeSend(channel,'preview-mode',{mode:'semantic',generation:control.semanticGeneration,recovering:true,reason:'semantic-backlog-delivery-failed'});
   return observedMetadata;
  }
  console.log('WPE semantic backlog delivered',control.row.id,message.type);
  control.semanticBacklog.shift();
 }
 const batch=normalizeSemanticBatch(await engine.drainSemantic(semanticLimits.batchBytes,semanticLimits.batchMessages));
 if(!batch.installed){control.semanticInstalled=false;await installSemantic(engine,channel,control);control.semanticControls.unshift({type:'dash:dom-stream-start',payload:{trigger:'semantic-detached'}});return observedMetadata;}
 control.semanticGeneration=batch.generation;
 if(batch.dropped||batch.rejected){
  requestSemanticResync(control,'bridge-backpressure',{dropped:batch.dropped,rejected:batch.rejected});
  await realtimeSend(channel,'preview-mode',{mode:'semantic',generation:batch.generation,recovering:true,dropped:batch.dropped,rejected:batch.rejected});
 }
 for(const message of batch.messages){
  if(message.type==='ext:dom-snapshot'&&typeof message.payload?.url==='string')observedMetadata={url:message.payload.url,title:String(message.payload?.title||'')};
  if(!await publishSemantic(channel,message)){
   requestSemanticResync(control,'semantic-delivery-failed');
   await realtimeSend(channel,'preview-mode',{mode:'semantic',generation:batch.generation,recovering:true,reason:'semantic-delivery-failed'});
   break;
  }
 }
 return observedMetadata;
}
async function createEngine(proxyURL,driverURL,pageLoadStrategy){let failure;const captureURL=captureURLs[driverURLs.indexOf(driverURL)];for(let attempt=0;attempt<6;attempt++){const engine=new WpeClient(null,driverURL,captureURL);try{await engine.create({proxy:proxyURL,pageLoadStrategy});return engine;}catch(error){failure=error;let cleaned=true;try{await engine.close();}catch{cleaned=false;}if(error.driverReusable===false||!cleaned){error.driverReusable=false;throw error;}if(attempt<5)await sleep(500*(attempt+1));}}failure.driverReusable=true;throw failure;}
async function navigateWithRetry(engine,target,attempts=2,timeoutMs=45000){
 const destination=new URL(target);let failure;
 for(let attempt=0;attempt<attempts;attempt++)try{return await engine.navigate(target,timeoutMs);}catch(error){
  failure=error;const current=await engine.url(Math.min(5000,timeoutMs)).catch(()=>null);
  if(current){try{const loaded=new URL(current);if(['http:','https:'].includes(loaded.protocol)&&loaded.hostname===destination.hostname)return {loaded_after_timeout:true};}catch{}}
  if(attempt+1<attempts)await sleep(500*(attempt+1));
 }
 throw failure;
}
async function flushActions(control){
 if(control.flushing||!control.actions.length)return;control.flushing=true;const batch=control.actions.splice(0,100);
 try{await query(db.from('session_actions').insert(batch));}catch{if(control.actions.length<900)control.actions.unshift(...batch);}finally{control.flushing=false;}
}
async function runSession(row){
 let driverURL=freeDrivers.shift();const engineQueue=createSerialExecutor();let profileRestoreTracker={origins:new Set(),deletions:new Set()},engine,proxy,stream,profileState,profileRevision=1,startupHeartbeatTimer,deadlineTimer,hardAbortTimer,deadlineCapture,leaseTimer,downloadLoop,commandPoll=null,profileOriginRestore=null,profileOriginFailure=null,driverReusable=true,lastPreview=0,lastVisualProbe=0,lastVisualState='',lastSemantic=0,lastSemanticInstall=0,lastPreviewHash='',lastPreviewState='',lastHeartbeat=0,lastLeaseWarning=0,lastCommandPoll=0,lastActionFlush=0,lastMetadataAt=0,lastMetadataState='',lastTabProbe=0,metadataInFlight=false,metadataWrite=Promise.resolve(),terminal='completed',failure=null,started=0,leaseDeadline=Date.now()+60000;const control={row,stop:false,expired:false,wake:null,forceFrame:row.preview_mode==='visual',frameFeedbackUntil:0,pixelActive:row.preview_mode==='visual',semanticInstalled:false,semanticGeneration:0,semanticBacklog:[],semanticControls:[],semanticControlBytes:0,semanticPriming:false,clients:new Set(),actions:[],flushing:false,applyInput:null,navigate:null,switchTab:null,newTab:null,closeTab:null,probeTabs:null,tabs:[],activeTab:null,releaseInput:null,inputPriority:false,inputPriorityTimer:null,controlEpoch:0};active.set(row.id,control);
 // Browser creation and the first navigation happen while the row remains in
 // `starting`. Keep that state alive without beginning billable runtime or
 // exposing a preview ticket before the selected renderer is actually ready.
 startupHeartbeatTimer=setInterval(()=>{void query(db.from('browser_sessions').update({heartbeat_at:new Date().toISOString()}).eq('id',row.id).eq('worker_id',worker).eq('status','starting')).catch(()=>{});},5000);startupHeartbeatTimer.unref();
 const engineTask=task=>engineQueue.run(task);
 const prepareProfileOrigin=async(candidate,target,tracker,timeoutMs=20000)=>{
  if(!profileState)return;
  const destination=new URL(target),portable=profileStateForRestore(profileState,target,tracker);
  if(!shouldApplyWpeState(portable))return;
  const bootstrap=portable.deleted_cookies?.length?destination.href:new URL('/robots.txt',destination.origin).href;
  await beginNavigationWithWait(candidate,bootstrap,{timeoutMs,pause:sleep});
  const current=new URL(await candidate.url());
  if(current.origin!==destination.origin)throw Error('Browser profile bootstrap redirected away from its saved origin');
  await applyPortableProfile(candidate,profileState,tracker,destination.href,{pause:sleep});
 };
 // `none` keeps WebDriver commands responsive while slow/CDN-heavy pages are
 // loading. Readiness is enforced explicitly by beginNavigationWithWait, so
 // neither renderer pays WebDriver's blocking page-load timeout.
 const launchEngine=async()=>{
  const candidateOrigins=new WeakMap();
  const candidate=await createNavigatedEngine({
  create:()=>createEngine(proxy?.url||null,driverURL,'none'),
  prepare:async(candidate,target,context)=>{
   // Apply portable corrections before the target page runs. In particular,
   // a page that rotates an auth cookie during its first load must never have
   // that fresh value overwritten by the previous portable snapshot.
   const tracker={origins:new Set(),deletions:new Set()};candidateOrigins.set(candidate,tracker);
   await prepareProfileOrigin(candidate,target,tracker,Math.min(20000,context.remainingMs));
  },
  navigate:(candidate,target,context)=>beginNavigationWithWait(candidate,target,{timeoutMs:Math.min(45000,context.remainingMs),pause:sleep}),target:row.url,attempts:6,timeoutMs:65000,pause:sleep
  });
  await replayPortableCache(candidate,profileState,row.url);
  profileRestoreTracker=candidateOrigins.get(candidate)||{origins:new Set(),deletions:new Set()};
  return candidate;
 };
 const queueProfileOriginRestore=observedUrl=>{
  let needed=false;
  try{needed=profileOriginNeedsRestore(profileState,observedUrl,profileRestoreTracker);}catch{return;}
  if(!needed||profileOriginRestore||control.stop)return;
  profileOriginRestore=engineTask(async()=>{
   const current=String(await engine.url());
   if(!profileOriginNeedsRestore(profileState,current,profileRestoreTracker))return;
   if(!await applyPortableProfile(engine,profileState,profileRestoreTracker,null,{pause:sleep}))return;
   if(row.preview_mode==='semantic'){
    if(await installSemantic(engine,stream,control))await primeSemantic(engine,control);
   }else control.forceFrame=true;
  }).catch(error=>{
   if(isFatalEngineFailure(error))profileOriginFailure=error;
   else console.error('WPE browser navigation profile restore deferred',row.id,String(error.message).slice(0,120));
  }).finally(()=>{profileOriginRestore=null;control.wake?.();control.wake=null;});
 };
 control.beginInput=async()=>{clearTimeout(control.inputPriorityTimer);control.inputPriorityTimer=null;control.inputPriority=true;control.wake?.();control.wake=null;await engineTask(()=>{});};
 control.endInput=()=>{clearTimeout(control.inputPriorityTimer);control.inputPriorityTimer=null;control.inputPriority=false;if(row.preview_mode==='visual')control.frameFeedbackUntil=Date.now()+1600;control.wake?.();control.wake=null;};
 control.deferInputEnd=(delay=1000)=>{clearTimeout(control.inputPriorityTimer);control.inputPriorityTimer=setTimeout(control.endInput,delay);control.inputPriorityTimer.unref();};
 // Match the database's 60-second stale-session boundary. Heartbeats still run
 // every five seconds, but one transient cross-region database stall no longer
 // tears down an otherwise healthy direct browser connection after 30 seconds.
 const requestLease=createLeaseRenewer(async heartbeat=>{const updated=await query(db.from('browser_sessions').update({heartbeat_at:heartbeat}).eq('id',row.id).eq('worker_id',worker).eq('status','running').select('id'));return updated.length===1;},{ttlMs:60000});
 const loseLease=()=>{terminal='failed';failure='Browser lost its control-plane lease. The unused reservation has been released.';control.stop=true;control.wake?.();control.wake=null;};
 const renewLease=async()=>{const lease=await requestLease();if(!lease)return false;lastHeartbeat=lease.heartbeatAt;leaseDeadline=lease.deadline;return true;};
 const recordMetadata=(titleValue,urlValue,force=false)=>{
  const title=String(titleValue||'').slice(0,200),url=String(urlValue||''),state=`${title}\n${url}`;control.row.title=title;control.row.url=url;
  if(force||state!==lastMetadataState){lastMetadataState=state;metadataWrite=metadataWrite.catch(()=>{}).then(()=>query(db.from('browser_sessions').update({title,url}).eq('id',row.id).eq('worker_id',worker).eq('status','running'))).catch(()=>{});}
 };
 const refreshMetadata=async(force=false)=>{
  if(!engine||metadataInFlight)return;metadataInFlight=true;
  try{
   const [titleValue,urlValue]=await engineTask(()=>Promise.all([engine.title(),engine.url()]));recordMetadata(titleValue,urlValue,force);queueProfileOriginRestore(urlValue);
  }finally{metadataInFlight=false;}
 };
 const validTabHandle=value=>typeof value==='string'&&value.length>0&&value.length<=256&&/^[A-Za-z0-9_.:-]+$/.test(value);
 const resetTabPreview=async reason=>{
  control.semanticInstalled=false;control.semanticGeneration=0;control.semanticBacklog=[];control.semanticControls=[];control.semanticControlBytes=0;control.semanticPriming=false;
  lastSemantic=0;lastSemanticInstall=0;lastPreview=0;lastPreviewHash='';lastPreviewState='';lastVisualProbe=0;lastVisualState='';control.forceFrame=row.preview_mode==='visual';control.frameFeedbackUntil=Date.now()+1600;
  await realtimeSend(stream,'preview-reset',{reason,active_tab:control.activeTab});
 };
 const syncTabsEngine=async({activateNew=false,force=false,resetReason='',resetOnChange=true}={})=>{
  const raw=await engine.windowHandles(),handles=Array.isArray(raw)?raw.filter(validTabHandle):[];
  if(!handles.length)throw Error('Browser has no open tabs');
  const previousHandles=new Set(control.tabs.map(tab=>tab.handle)),added=handles.filter(handle=>!previousHandles.has(handle));
  let current=await engine.currentWindow().catch(()=>null);
  if(activateNew&&added.length){current=added.at(-1);await engine.release().catch(()=>{});await engine.switchWindow(current);resetReason='new-tab';}
  else if(!validTabHandle(current)||!handles.includes(current)){current=handles.at(-1);await engine.switchWindow(current);resetReason='tab-recovered';}
  const changedActive=current!==control.activeTab;
  control.activeTab=current;
  if(resetReason||(changedActive&&resetOnChange))await resetTabPreview(resetReason||'tab-changed');
  const previous=new Map(control.tabs.map(tab=>[tab.handle,tab])),[titleValue,urlValue]=await Promise.all([engine.title().catch(()=>''),engine.url().catch(()=>'about:blank')]);
  const title=String(titleValue||'').slice(0,200),url=String(urlValue||'about:blank');
  control.tabs=handles.map((handle,index)=>handle===current?{handle,title:title||`Tab ${index+1}`,url,active:true}:{handle,title:previous.get(handle)?.title||`Tab ${index+1}`,url:previous.get(handle)?.url||'',active:false});
  const serialized=JSON.stringify(control.tabs),changed=serialized!==control.tabsSerialized;
  control.tabsSerialized=serialized;
  recordMetadata(title,url,Boolean(resetReason));
  if(force||changed)await realtimeSend(stream,'tabs',{tabs:control.tabs,active_tab:current});
  return control.tabs;
 };
 const syncTabs=options=>syncTabsEngine(options);
 try{
  if(!driverURL)throw Error('No WPE driver slot is available');const destination=webURL(row.url);await resolvePublic(destination.hostname);if(row.proxy_id){const configured=await query(db.from('proxy_servers').select('encrypted_url,enabled').eq('id',row.proxy_id).eq('user_id',row.user_id).eq('project_id',row.project_id).single());if(!configured.enabled)throw Error('Configured proxy is disabled');proxy=await startProxy(unseal(configured.encrypted_url,row.user_id));}profileState=await loadProfile(row);profileRevision=Math.max(profileState?.cookieRevision||0,...(profileState?.origins||[]).map(origin=>origin.revision||0))+1;stream=await openStream(row,control);
  if(downloadsEnabled){
   try{const runtime=await startDownloadRuntime({session:row,worker,rpc,engineFactory:()=>new WpeClient(null,driverURL,captureURLs[driverURLs.indexOf(driverURL)]),proxy:proxy?.url||null,profileDir:null});engine=runtime.engine;downloadLoop=new DownloadLoop(runtime,{renewLease,onError:()=>console.error('WPE download publication deferred',row.id)});}
   catch(error){driverReusable=error.driverReusable===true;throw error;}
	  }else try{engine=await launchEngine();await applyPortableProfile(engine,profileState,profileRestoreTracker,null,{pause:sleep});if(await installSemantic(engine,stream,control))await primeSemantic(engine,control);}catch(error){
	   if(error.driverRestartRequired&&freeDrivers.length){
	    const failedDriver=driverURL;restartRequested=true;await engine?.close().catch(()=>{});engine=null;driverURL=freeDrivers.shift();driverReusable=true;
	    console.error('WPE driver slot quarantined; retrying session on fallback slot',failedDriver,'->',driverURL);
	    try{engine=await launchEngine();await applyPortableProfile(engine,profileState,profileRestoreTracker,null,{pause:sleep});if(await installSemantic(engine,stream,control))await primeSemantic(engine,control);}catch(fallback){driverReusable=fallback.driverReusable===true&&!fallback.driverRestartRequired;throw fallback;}
	   }else{driverReusable=error.driverReusable===true&&!error.driverRestartRequired;throw error;}
	  }
  control.releaseInput=()=>engineTask(()=>engine.release());
	  // Overlay captured portable state after native restore. This repairs WPE
	  // archives that omit web storage while retaining engine-private state.
	  if(downloadsEnabled){await navigateWithRetry(engine,row.url);await applyPortableProfile(engine,profileState,profileRestoreTracker,null,{pause:sleep});if(await installSemantic(engine,stream,control))await primeSemantic(engine,control);}
  if(!(await rpc('start_session',{p_session:row.id,p_worker:worker})))throw Error('Session was canceled before startup');clearInterval(startupHeartbeatTimer);startupHeartbeatTimer=null;started=Date.now();lastHeartbeat=started;leaseDeadline=started+60000;deadlineTimer=setTimeout(()=>{control.expired=true;control.stop=true;control.controlEpoch++;for(const socket of control.clients)socket.close(4003,'Session expired');deadlineCapture=engineTask(async()=>{profileState=await captureProfile(engine,profileState,profileRevision);await engine.release().catch(()=>{});}).catch(()=>{});hardAbortTimer=setTimeout(()=>engine?.abort('WPE session deadline exceeded'),5000);hardAbortTimer.unref();control.wake?.();control.wake=null;},row.max_seconds*1000);
  leaseTimer=setInterval(()=>{void renewLease().then(accepted=>{if(!accepted)loseLease();}).catch(error=>{if(Date.now()-lastLeaseWarning>15000){lastLeaseWarning=Date.now();console.error('WPE lease renewal deferred',row.id,String(error.message).slice(0,120));}});},5000);leaseTimer.unref();
  // Metadata is not allowed to occupy the engine queue before the first
  // snapshot/frame. The original session URL is already in Postgres; richer
  // title/redirect metadata is refreshed only while nobody is viewing.
  lastMetadataAt=Date.now();
  const requireActive=expectedEpoch=>{if(control.expired||control.stop||Date.now()-started>=row.max_seconds*1000)throw Error('Browser session has ended');if(Number.isSafeInteger(expectedEpoch)&&expectedEpoch!==control.controlEpoch)throw Error('Stale browser control ticket');};
  control.probeTabs=()=>{if(control.tabProbePending)return control.tabProbePending;control.tabProbePending=engineTask(()=>syncTabs({activateNew:true})).catch(error=>{if(isFatalEngineFailure(error)){driverReusable=false;control.stop=true;}else console.error('WPE tab discovery deferred',row.id,String(error.message).slice(0,120));}).finally(()=>{control.tabProbePending=null;});return control.tabProbePending;};
  control.applyInput=async(events,expectedEpoch)=>{requireActive(expectedEpoch);const result=await engineTask(()=>{requireActive(expectedEpoch);return engine.input(events);});if(events.some(event=>event?.type==='pointer'&&event.phase==='up'))void control.probeTabs();return result;};
	  control.navigate=async(value,expectedEpoch)=>{requireActive(expectedEpoch);await engineTask(async()=>{requireActive(expectedEpoch);const url=webURL(value);await resolvePublic(url.hostname);try{profileState=await captureProfile(engine,profileState,profileRevision);}catch{console.error('WPE portable profile capture deferred',row.id);}await prepareProfileOrigin(engine,url.href,profileRestoreTracker);await resetTabPreview('navigate');const navigated=await beginNavigationWithWait(engine,url.href,{timeoutMs:45000,pause:sleep});recordMetadata(control.row.title,navigated.url,true);if(row.preview_mode==='semantic'){await installSemantic(engine,stream,control);await primeSemantic(engine,control);}else{control.forceFrame=true;control.frameFeedbackUntil=Date.now()+1600;}await syncTabs({force:true,resetOnChange:false});});if(!streamCanPush(stream))void refreshMetadata(true).catch(()=>{});};
	  control.switchTab=(handle,expectedEpoch)=>{requireActive(expectedEpoch);if(!validTabHandle(handle))throw Error('Invalid browser tab');return engineTask(async()=>{requireActive(expectedEpoch);await syncTabsEngine({resetOnChange:false});if(!control.tabs.some(tab=>tab.handle===handle))throw Error('Browser tab is no longer open');if(handle!==control.activeTab){await engine.release().catch(()=>{});await engine.switchWindow(handle);control.activeTab=handle;await resetTabPreview('tab-switch');}return syncTabsEngine({force:true,resetOnChange:false});});};
	  control.newTab=expectedEpoch=>{requireActive(expectedEpoch);return engineTask(async()=>{requireActive(expectedEpoch);await engine.release().catch(()=>{});await engine.newWindow('tab');await resetTabPreview('tab-new');return syncTabsEngine({activateNew:true,force:true,resetOnChange:false});});};
	  control.closeTab=(handle,expectedEpoch)=>{requireActive(expectedEpoch);if(!validTabHandle(handle))throw Error('Invalid browser tab');return engineTask(async()=>{requireActive(expectedEpoch);await syncTabsEngine({resetOnChange:false});if(!control.tabs.some(tab=>tab.handle===handle))throw Error('Browser tab is no longer open');if(control.tabs.length<=1)throw Error('The last browser tab cannot be closed');const previous=control.activeTab;await engine.release().catch(()=>{});if(handle!==control.activeTab)await engine.switchWindow(handle);const closed=await engine.closeWindow(),handles=Array.isArray(closed)?closed.filter(validTabHandle):(await engine.windowHandles()).filter(validTabHandle);if(!handles.length)throw Error('Browser has no open tabs');const next=previous!==handle&&handles.includes(previous)?previous:handles.at(-1);await engine.switchWindow(next);control.activeTab=next;await resetTabPreview('tab-close');return syncTabsEngine({force:true,resetOnChange:false});});};
	  await engineTask(()=>syncTabsEngine({force:true,resetOnChange:false}));
	  const processQueuedCommand=async()=>{
	   let command=null;try{[command]=await rpc('claim_command',{p_session:row.id});}catch(error){if(Date.now()>leaseDeadline)throw Error('Database lease lost',{cause:error});return;}
	   if(!command)return;
    if(control.stop&&command.kind!=='stop'){await query(db.from('browser_commands').update({status:'failed',payload:{},error:'Browser session has ended.',finished_at:new Date().toISOString()}).eq('id',command.id));return;}
    try{
     const payload=command.payload.encrypted?unseal(command.payload.encrypted,row.user_id):command.payload,expectedEpoch=commandEpoch(control,command);let result={};
     if(command.kind==='stop'){control.stop=true;control.wake?.();control.wake=null;}
     else if(command.kind==='navigate'){await control.navigate(payload.url,expectedEpoch);}
     else if(command.kind==='click')await control.applyInput([{type:'pointer',phase:'down',x:Math.round(payload.x),y:Math.round(payload.y),button:0},{type:'pointer',phase:'up',x:Math.round(payload.x),y:Math.round(payload.y),button:0}],expectedEpoch);
     else if(command.kind==='drag')await control.applyInput(dragInputEvents(payload),expectedEpoch);
     else if(command.kind==='type')await control.applyInput([{type:'text',text:payload.text}],expectedEpoch);
     else if(command.kind==='key')await control.applyInput(keyEvents(payload.key),expectedEpoch);
     else if(command.kind==='scroll')await control.applyInput([{type:'wheel',x:640,y:400,delta_x:0,delta_y:Math.round(payload.delta)}],expectedEpoch);
     else if(command.kind==='input')await control.applyInput(payload.events,expectedEpoch);
     else if(command.kind==='snapshot')result={snapshot:serializeSnapshot(await engineTask(()=>{requireActive(expectedEpoch);return engine.snapshot();})),tabs:await control.probeTabs().then(()=>control.tabs),active_tab:control.activeTab};
     else if(command.kind==='tabs')result={tabs:await control.probeTabs().then(()=>control.tabs),active_tab:control.activeTab};
     else if(command.kind==='tab_switch')result={tabs:await control.switchTab(payload.handle,expectedEpoch),active_tab:control.activeTab};
     else if(command.kind==='tab_new')result={tabs:await control.newTab(expectedEpoch),active_tab:control.activeTab};
     else if(command.kind==='tab_close')result={tabs:await control.closeTab(payload.handle,expectedEpoch),active_tab:control.activeTab};
     else if(command.kind==='evaluate')result={evaluation:await engineTask(()=>{requireActive(expectedEpoch);return engine.evaluate(payload.expression);})};
     else if(command.kind==='credential'){
      await fencedLookup(()=>query(db.from('credentials').select('*').eq('id',payload.credential_id).eq('user_id',row.user_id).single()),credential=>engineTask(async()=>{requireActive(expectedEpoch);const current=new URL(await engine.url());requireActive(expectedEpoch);if(current.protocol!=='https:'||current.hostname!==credential.hostname)throw Error('Credential hostname mismatch');await engine.input([{type:'text',text:unseal(credential.encrypted_value,row.user_id)}]);}),()=>requireActive(expectedEpoch));
     }else if(command.kind==='vault'){
      await fencedLookup(()=>query(db.from('vaults').select('*').eq('id',payload.vault_id).eq('user_id',row.user_id).eq('project_id',row.project_id).single()),vault=>engineTask(async()=>{requireActive(expectedEpoch);const current=new URL(await engine.url());requireActive(expectedEpoch);if(current.protocol!=='https:'||current.hostname!==vault.hostname)throw Error('Vault hostname mismatch');await engine.input([{type:'text',text:unseal(vault.encrypted_value,row.user_id)}]);}),()=>requireActive(expectedEpoch));
     }else throw Error('Unsupported browser command');
     await query(db.from('browser_commands').update({status:'completed',payload:{},result:{url:await engineTask(()=>engine.url()),...result},finished_at:new Date().toISOString()}).eq('id',command.id));
    }catch(error){
     const fatal=isFatalEngineFailure(error);
     if(fatal){
      driverReusable=false;restartRequested=true;terminal='failed';failure='Browser engine stopped responding. The unused reservation has been released.';control.stop=true;control.wake?.();control.wake=null;
      await query(db.from('browser_commands').update({status:'failed',payload:{},error:'Browser engine stopped responding.',finished_at:new Date().toISOString()}).eq('id',command.id)).catch(()=>{});throw error;
     }
     await query(db.from('browser_commands').update({status:'failed',payload:{},error:'Action failed or destination blocked. Check the page and retry.',finished_at:new Date().toISOString()}).eq('id',command.id));
    }
    lastPreview=0;
	  };
	  while(!stopping&&!control.stop&&Date.now()-started<row.max_seconds*1000){
	   if(profileOriginFailure)throw profileOriginFailure;
	   if(Date.now()>leaseDeadline)throw Error('Database lease lost');
	   // A transient control-plane outage must not interrupt an already-issued
	   // direct preview/input capability. Database command compatibility is
	   // polled independently and never blocks a frame, DOM batch, or input ACK.
	   if(!commandPoll&&Date.now()-lastCommandPoll>=250){lastCommandPoll=Date.now();commandPoll=processQueuedCommand().catch(error=>{if(Date.now()>leaseDeadline){console.error('WPE command queue lease lost',row.id,String(error.message).slice(0,120));loseLease();}}).finally(()=>{commandPoll=null;});}
   // Drain only the batch present at loop entry. A failed resync request is
   // retried after the scheduler delay instead of recursively refilling this
   // queue and starving timers, leases, and other browser sessions.
   const semanticControlBatch=Math.min(control.semanticControls.length,1);
   for(let index=0;index<semanticControlBatch&&!control.stop&&!control.inputPriority&&control.semanticInstalled;index++){
   const request=control.semanticControls.shift();control.semanticControlBytes=Math.max(0,(Number(control.semanticControlBytes)||0)-(Number(request.size)||0));
    console.log('WPE semantic control',row.id,request.type);
    try{
     // A viewer may reconnect after the tunnel accepted a write that never
     // reached the client. Rebuild and retain a canonical snapshot for START
     // instead of trusting a fire-and-forget page control message.
     if(request.type==='dash:dom-stream-start'){
      control.semanticPriming=true;
      try{await engineTask(()=>primeSemantic(engine,control));}finally{control.semanticPriming=false;}
     }
     else await engineTask(()=>engine.semanticControl(request.type,request.payload));
    }
    catch(error){if(error.driverRestartRequired||error.driverReusable===false||/closed|exited/i.test(String(error.message))){driverReusable=false;throw error;}control.semanticInstalled=false;requestSemanticResync(control,'semantic-control-failed');break;}
   }
   if(!control.stop&&!control.inputPriority&&row.preview_mode==='semantic'&&streamCanPush(stream)&&!control.semanticInstalled&&Date.now()-lastSemanticInstall>750){
    lastSemanticInstall=Date.now();
    try{if(await engineTask(()=>installSemantic(engine,stream,control)))await engineTask(()=>primeSemantic(engine,control));}catch(error){if(error.driverRestartRequired||error.driverReusable===false){driverReusable=false;throw error;}}
   }
	   if(!control.stop&&!control.inputPriority&&control.semanticInstalled&&Date.now()-lastSemantic>55){try{const observed=await engineTask(()=>drainSemantic(engine,stream,control));if(observed){recordMetadata(observed.title,observed.url);queueProfileOriginRestore(observed.url);}}catch(error){if(error.driverRestartRequired||error.driverReusable===false){driverReusable=false;throw error;}control.semanticInstalled=false;requestSemanticResync(control,'semantic-drain-failed');}lastSemantic=Date.now();}
   // Visual capture is change-driven. A cheap revision probe coalesces DOM,
   // scroll and viewport changes; the expensive PNG path runs only for the
   // initial frame, a real page change, or input feedback. This is the visual
   // equivalent of latest-frame semantics and keeps screenshots out of the
   // control hot path on static pages.
   const frameFeedbackPending=Date.now()<control.frameFeedbackUntil;
   if(!control.stop&&!control.inputPriority&&control.pixelActive&&streamCanPush(stream)&&(control.forceFrame||frameFeedbackPending||!lastPreviewHash||Date.now()-lastVisualProbe>250)){
    const forceFrame=control.forceFrame;if(forceFrame)control.forceFrame=false;
    try{
     // WPE execute-script commands can remain blocked while a remote document
     // is loading. Keep Visual entirely on the independent compositor path;
     // the frame hash suppresses unchanged network frames without putting
     // screenshot or DOM probes in front of direct input acknowledgements.
     const visual={title:control.row.title,url:control.row.url};
     lastVisualProbe=Date.now();
     const preview=await publish(engine,stream,lastPreviewHash,lastPreviewState,forceFrame,streamCanPush(stream),visual);
     if(preview.delivered){lastPreviewHash=preview.hash;lastPreviewState=preview.state;recordMetadata(preview.title,preview.url);queueProfileOriginRestore(preview.url);}
     else if(forceFrame)control.forceFrame=true;
     lastPreview=Date.now();
    }
    catch(error){if(isFatalEngineFailure(error)){driverReusable=false;throw error;}control.forceFrame=true;lastPreview=Date.now()+875;console.error('WPE visual preview retry',row.id,String(error.message).slice(0,120));}
   }
   if(control.actions.length&&Date.now()-lastActionFlush>1000){lastActionFlush=Date.now();void flushActions(control);}
	   if(!control.stop&&!control.inputPriority&&streamCanPush(stream)&&Date.now()-lastTabProbe>750){lastTabProbe=Date.now();void control.probeTabs();}
	   if(!control.stop&&!control.inputPriority&&(row.preview_mode==='semantic'||!streamCanPush(stream))&&Date.now()-lastMetadataAt>5000){lastMetadataAt=Date.now();void refreshMetadata().catch(()=>{});}
   if(downloadLoop&&!control.stop)downloadLoop.kick();
   await Promise.race([sleep(80),new Promise(resolve=>{control.wake=resolve;})]);control.wake=null;
  }
 }catch(error){if(!control.stop){terminal='failed';failure='Browser could not complete the session. The unused reservation has been released.';console.error('WPE session failure',row.id,String(error.message).replace(/https?:\/\/\S+/g,'[url]').slice(0,250));}}
 finally{
  control.stop=true;for(const socket of control.clients)socket.close(1000,'Session ended');clearInterval(startupHeartbeatTimer);clearTimeout(deadlineTimer);clearTimeout(control.inputPriorityTimer);clearInterval(leaseTimer);await commandPoll?.catch(()=>{});await engineQueue.drain();if(deadlineCapture)await deadlineCapture;clearTimeout(hardAbortTimer);if(engine){if(started&&!control.expired)try{profileState=await captureProfile(engine,profileState,profileRevision);}catch{}await engine.release().catch(()=>{});
   if(downloadLoop){try{const result=await downloadLoop.close();driverReusable=result.driverReusable;}catch(error){driverReusable=error.driverReusable===true;terminal='failed';failure='Browser download publication did not complete. Local spool retained for recovery.';console.error('WPE download finalization failed',row.id);}}
   else try{await engine.close();}catch(error){driverReusable=!engine.sessionId;}
  }
  if(!driverReusable){restartRequested=true;console.error('WPE driver slot quarantined; worker recycle requested',driverURL);}
  let profilePersisted=!row.profile_id||!profileState||!started;
  if(row.profile_id&&profileState&&started&&driverReusable){
   try{await persistProfile(row,{...profileState,nativeRevision:0});profilePersisted=true;}catch{console.error('WPE profile state save failed',row.id);}
   if(!profilePersisted){terminal='failed';failure='Browser profile persistence did not complete.';}
  }
  await metadataWrite.catch(()=>{});await flushActions(control);proxy?.close();if(driverURL&&driverReusable&&!restartRequested)freeDrivers.push(driverURL);for(let attempt=0;attempt<3;attempt++){try{await rpc('finish_session',{p_session:row.id,p_status:terminal,p_error:failure});break;}catch{await sleep(1000);}}active.delete(row.id);
 }
}
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});console.log('jet-browser WPE worker starting',worker,region);
let heartbeatInFlight=false;
const heartbeatWorker=async()=>{
 if(heartbeatInFlight)return;heartbeatInFlight=true;
 try{const host=readHostResources(),memory=process.memoryUsage(),row={id:worker,region,heartbeat_at:new Date().toISOString(),capacity:draining&&drainAcknowledged?0:capacity,active_sessions:active.size,draining,started_at:workerStartedAt,resource:{cpu_count:host.cpuCount,load_1:Number(host.load1.toFixed(2)),memory_total_bytes:host.totalMemoryBytes,memory_available_bytes:host.availableMemoryBytes,rss_bytes:memory.rss,heap_used_bytes:memory.heapUsed,driver_slots:capacity,free_driver_slots:freeDrivers.length},version:workerVersion};if(!sharedDirectRouter){row.direct_url=directURL;row.direct_updated_at=directURL?new Date().toISOString():null;}const registered=await query(db.from('workers').upsert(row).select('direct_url').single());if(sharedDirectRouter)directURL=registered.direct_url?.startsWith('https://')?registered.direct_url:null;}
 catch{console.error('WPE worker heartbeat failed');}
 finally{heartbeatInFlight=false;}
};
const acknowledgeDrain=()=>{if(draining&&!claimInFlight){drainAcknowledged=true;void heartbeatWorker();}};
process.on('SIGUSR1',()=>{draining=true;drainAcknowledged=false;acknowledgeDrain();});
process.on('SIGUSR2',()=>{draining=false;drainAcknowledged=false;void heartbeatWorker();});
await heartbeatWorker();const heartbeatTimer=setInterval(()=>{void heartbeatWorker();},5000);heartbeatTimer.unref();
while(!stopping){if(restartRequested&&active.size===0){stopping=true;break;}try{await rpc('expire_sessions',{});if(!restartRequested&&!draining&&directURL&&active.size<capacity&&freeDrivers.length){let row;claimInFlight=true;try{[row]=await rpc('claim_regional_session',{p_worker:worker,p_region:region});}finally{claimInFlight=false;}if(row)void runSession(row);acknowledgeDrain();}}catch{claimInFlight=false;acknowledgeDrain();console.error('WPE worker control-plane connection failed');}await sleep(1500);}
clearInterval(heartbeatTimer);while(active.size)await sleep(250);stopTunnel();await dataPlane.close();await db.from('workers').delete().eq('id',worker);
if(restartRequested)process.exitCode=1;
