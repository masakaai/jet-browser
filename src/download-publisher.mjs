import {parseDownloadJournal} from './download-journal.mjs';
import {readCompletedDownload} from './download-file.mjs';
import {seal} from './vault.mjs';

// Construct only after the launcher has bound a private root to an assigned
// session. This class does not discover roots by scanning a shared directory.
export class DownloadPublisher {
 #binding; #root; #rpc; #confirm; #reportFailure; #failedSent=new Set(); #seal; #pending=new Map(); #sent=new Map(); #flight=null; #closed=false;
 constructor({sessionId,owner,projectId,worker,root,rpc,confirmReceipt,reportFailure,encrypt=seal}){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if(![sessionId,owner,projectId].every(value=>typeof value==='string'&&uuid.test(value))||typeof worker!=='string'||!worker||worker.length>200||typeof root!=='string'||typeof rpc!=='function'||typeof encrypt!=='function')throw Error('Invalid download publisher binding');
  this.#binding=Object.freeze({sessionId,owner,projectId,worker});this.#root=root;this.#rpc=rpc;this.#seal=encrypt;
  if(confirmReceipt!==undefined&&typeof confirmReceipt!=='function')throw Error('Invalid download receipt reader');
  this.#confirm=confirmReceipt;
  if(reportFailure!==undefined&&typeof reportFailure!=='function')throw Error('Invalid download failure reporter');
  this.#reportFailure=reportFailure;
 }
 flush(journal){
  if(this.#closed)return Promise.reject(Error('Download publisher is closed'));
  // One snapshot per in-flight flush. Newer snapshots are consumed next poll.
  if(this.#flight)return this.#flight;
  this.#flight=this.#flush(journal).finally(()=>{this.#flight=null;});return this.#flight;
 }
 async #flush(journal){
  const snapshot=parseDownloadJournal(journal),published=[];
  const pendingFailures=this.#reportFailure?snapshot.failed.filter(id=>!this.#failedSent.has(id)):[];
  if(pendingFailures.length){
   const {sessionId,worker}=this.#binding,id=pendingFailures[0];
   await this.#reportFailure({p_session:sessionId,p_worker:worker,p_id:id});
   this.#failedSent.add(id);
   // Share the one-RPC-per-poll budget with file publication.
   return {published:[],reportedFailures:[id],failed:snapshot.failed,pending:snapshot.pending,
    unpublished:[...pendingFailures.slice(1),...snapshot.completed.filter(item=>!this.#sent.has(item.id)).map(item=>item.id)]};
  }
  for(const item of snapshot.completed){
   if(this.#closed)break;
   const signature=JSON.stringify(item);
   if(this.#sent.has(item.id)){
    if(this.#sent.get(item.id)!==signature)throw Error('Published download metadata changed');
    continue;
   }
   if(Buffer.byteLength(item.name)>200)throw Error('Download name exceeds storage contract');
   const existing=this.#pending.get(item.id);
   if(existing&&existing.signature!==signature)throw Error('Pending download metadata changed');
   // Yield to the worker between publications so it can renew its lease and
   // process browser control. Unsubmitted completions remain in the journal.
   if(published.length)continue;
   let pending=existing;
   if(!pending){
    const file=await readCompletedDownload(this.#root,item.id,journal);
    if(this.#closed)break;
    const {sessionId,owner,worker}=this.#binding;
    const encrypted=this.#seal({sessionId,id:item.id,content:file.content.toString('base64')},owner);
    if(typeof encrypted!=='string'||!encrypted||encrypted.length>7600000)throw Error('Invalid encrypted download');
    pending={signature,parameters:{p_session:sessionId,p_worker:worker,p_id:item.id,p_name:item.name,p_size:file.bytes,p_sha256:file.sha256,p_encrypted_content:encrypted}};
    this.#pending.set(item.id,pending);
   }
   if(this.#closed)break;
   // RPC is idempotent on (session,id). On an ambiguous failure keep exactly
   // the same sealed payload; never mark sent until an acknowledgement.
   try{await this.#rpc('publish_browser_download',{...pending.parameters});}
   catch(error){
    // A missing response is not proof that the database rolled back. Confirm
    // only an existing immutable receipt; this does not authorize a new write.
    let confirmed=false;
    if(this.#confirm){const {p_encrypted_content,...receipt}=pending.parameters;try{confirmed=await this.#confirm(receipt)===true;}catch{}}
    if(!confirmed)throw error;
   }
   this.#sent.set(item.id,signature);this.#pending.delete(item.id);published.push(item.id);
  }
  return {published,failed:snapshot.failed,pending:snapshot.pending,
   unpublished:snapshot.completed.filter(item=>!this.#sent.has(item.id)).map(item=>item.id)};
 }
 async close(){this.#closed=true;try{await this.#flight;}finally{this.#pending.clear();}}
}
