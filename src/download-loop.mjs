import {finalizeDownloads} from './download-finalize.mjs';

// One loop per native session; finalization fences and drains ordinary polls.
export class DownloadLoop{
 constructor(runtime,{renewLease,now=()=>performance.now(),finalize=finalizeDownloads,onError=()=>{}}={}){
  if(typeof renewLease!=='function')throw Error('Download loop requires lease renewal');
  if(typeof onError!=='function')throw Error('Download loop requires an error callback');
  this.runtime=runtime;this.renewLease=renewLease;this.now=now;this.finalize=finalize;
  this.onError=onError;
  this.next=0;this.failures=0;this.flight=null;this.closing=false;this.finish=null;
 }
 tick(){
  if(this.closing)return Promise.resolve(null);
  if(this.flight)return this.flight;
  if(this.now()<this.next)return Promise.resolve(null);
  this.flight=(async()=>{
   try{
    if(await this.renewLease()!==true)throw Error('Download publication lease lost');
    const result=await this.runtime.poll();
    this.failures=0;this.next=this.now()+1000;return result;
   }catch(error){
    this.failures++;this.next=this.now()+Math.min(60000,1000*2**Math.min(this.failures,6));throw error;
   }
  })().finally(()=>{this.flight=null;});
  return this.flight;
 }
 kick(){
  if(this.closing||this.flight||this.now()<this.next)return false;
  // One observer per actual flight, not one per 80ms browser-loop tick.
  void this.tick().catch(error=>{try{this.onError(error);}catch{}});
  return true;
 }
 close(){
  if(this.finish)return this.finish;
  this.closing=true;
  this.finish=(async()=>{
   await this.flight?.catch(()=>{});
   return this.finalize(this.runtime,{renewLease:this.renewLease});
  })();
  return this.finish;
 }
}
