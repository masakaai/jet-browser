import {randomUUID} from 'node:crypto';
import {DownloadPublisher} from './download-publisher.mjs';
import {waitForDownloadReady,readNativeDownloadJournal} from './download-ready.mjs';

// Internal lifecycle adapter. No driver retries: unknown creation outcomes
// require quarantine, even when the client never received a session ID.
export async function startDownloadRuntime({session,worker,rpc,engineFactory,proxy,profileDir,waitReady=waitForDownloadReady}){
 const token=randomUUID(),root='/var/lib/masaka-downloads/'+token;
 const publisher=new DownloadPublisher({sessionId:session?.id,owner:session?.user_id,projectId:session?.project_id,worker,root,rpc,confirmReceipt:receipt=>rpc('confirm_browser_download',receipt),reportFailure:receipt=>rpc('report_browser_download_failure',receipt)});
 let engine,created=false;
 try{
  engine=engineFactory();
  await engine.create({proxy,profileDir,downloadToken:token});created=true;
  const ready=await waitReady(root);
  if(ready?.ready!==true)throw Error('Native download manager is not ready');
  return {
   engine,token,root,publisher,
   async poll(){
    const journal=await readNativeDownloadJournal(root);
    if(!journal.ready)throw Error('Native download manager lost readiness');
    return publisher.flush(journal.text);
   },
  };
 }catch(cause){
  let closed=false;
  if(engine)try{await engine.close();closed=!engine.sessionId;}catch{}
  await publisher.close();
  throw Object.assign(new Error(`Download startup failed: ${cause.message}`,{cause}),{driverReusable:!engine||(created&&closed)});
 }
}
