// Coalesce heartbeat writes across the command loop and download publisher.
// The database stores the request timestamp, not the response timestamp.
export function createLeaseRenewer(writeHeartbeat,{now=()=>Date.now(),ttlMs=30000}={}){
 if(typeof writeHeartbeat!=='function'||!Number.isFinite(ttlMs)||ttlMs<=0)throw Error('Invalid session lease options');
 let flight=null;
 return ()=>{
  if(flight)return flight;
  const heartbeatAt=now(),deadline=heartbeatAt+ttlMs;
  flight=Promise.resolve().then(()=>writeHeartbeat(new Date(heartbeatAt).toISOString())).then(accepted=>{
   if(accepted!==true||now()>=deadline)return null;
   return {heartbeatAt,deadline};
  }).finally(()=>{flight=null;});
  return flight;
 };
}
