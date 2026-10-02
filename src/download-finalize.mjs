// Invoke before finish_session, while the assigned worker can still renew the
// running session lease. Caller must stop starting ordinary runtime polls.
// Does not delete spool data: failed publication must remain recoverable.
export async function finalizeDownloads(runtime,{renewLease,timeoutMs=10000,now=()=>performance.now()}={}){
 if(typeof renewLease!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw Error('Invalid download finalization options');
 const deadline=now()+timeoutMs,published=[];let driverReusable=false,latest={unpublished:[],pending:[],failed:[]},failure;
 const withinBudget=()=>{if(now()>=deadline)throw Error('Download finalization deadline exceeded');};
 try{
  await runtime.engine.close();
  if(runtime.engine.sessionId)throw Error('Native browser close was not confirmed');
  driverReusable=true;
  for(let attempt=0;attempt<100;attempt++){
   withinBudget();
   if(await renewLease()!==true)throw Error('Download publication lease lost');
   withinBudget();
   const result=await runtime.poll();
   if(!result||!['published','unpublished','pending','failed'].every(key=>Array.isArray(result[key]))||(result.reportedFailures!==undefined&&!Array.isArray(result.reportedFailures)))throw Error('Invalid final download snapshot');
   latest=result;published.push(...result.published);
   if(!result.unpublished.length)break;
   if(!result.published.length&&!result.reportedFailures?.length)throw Error('Download publication made no progress');
  }
  if(latest.unpublished.length)throw Error('Download finalization publication limit exceeded');
 }catch(error){failure=error;}
 try{await runtime.publisher.close();}catch(error){failure??=error;}
 if(failure)throw Object.assign(new Error(`Download finalization failed: ${failure.message}`,{cause:failure}),{driverReusable,published,unpublished:latest.unpublished,interrupted:latest.pending});
 return {driverReusable,published,failed:latest.failed,interrupted:latest.pending};
}
