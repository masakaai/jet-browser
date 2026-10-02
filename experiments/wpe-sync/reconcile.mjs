import {mergeState} from './merge.mjs';

// Experimental, single-writer coordinator for explicitly allowlisted state only.
// Adapters must apply deletions and read back the entire allowlisted state.
// There is no cross-browser transaction: a failed partial write is surfaced,
// and the common baseline advances only after both read-backs match.
export function coordinator(local, remote, initial = {}) {
 let baseline=structuredClone(initial),busy=false;
 const same=(a,b)=>mergeState({},a,b).conflicts.length===0
   && Object.keys(a).length===Object.keys(b).length
   && Object.keys(a).every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));
 return async function reconcile(){
  if(busy)throw Error('Sync already in flight');
  busy=true;
  try{
   const [l,r]=await Promise.all([local.read(),remote.read()]);
   const {merged,conflicts}=mergeState(baseline,l,r);
   if(conflicts.length)return {status:'conflict',keys:conflicts};
   // Detect mutations while reads/merge were in progress. Not an atomic CAS.
   const [l2,r2]=await Promise.all([local.read(),remote.read()]);
   if(!same(l,l2)||!same(r,r2))return {status:'retry'};
   await local.write(merged);await remote.write(merged);
   const [actualLocal,actualRemote]=await Promise.all([local.read(),remote.read()]);
   if(!same(actualLocal,merged)||!same(actualRemote,merged))throw Error('Sync read-back mismatch');
   baseline=structuredClone(merged);
   return {status:'synced',keys:Object.keys(merged).length};
  }finally{busy=false;}
 };
}
