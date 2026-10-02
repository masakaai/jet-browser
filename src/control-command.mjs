export function commandEpoch(control,command){
 const raw=command?.control_epoch;
 if(raw===null||raw===undefined)return undefined;
 const epoch=Number(raw);
 if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('Invalid browser command epoch');
 const inputConnected=[...(control.clients||[])].some(socket=>socket.masaka?.claims.scope==='input');
 // The first agent acquisition does not need a revoke round trip because no
 // earlier controller exists. Adopt that first database epoch only while the
 // worker has never seen a control epoch and no direct input client is active.
 if(control.controlEpoch===0&&!inputConnected)control.controlEpoch=epoch;
 return epoch;
}

export async function fencedLookup(lookup,execute,verify){
 verify();
 const value=await lookup();
 verify();
 return execute(value);
}
