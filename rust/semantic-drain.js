const state=window.__masakaSemanticV1,maxBytes=Math.max(1,Math.min(Number(arguments[0])||1,2100000)),maxMessages=Math.max(1,Math.min(Number(arguments[1])||1,128));
if(!state||state.version!==1||!Array.isArray(state.queue))return {installed:false,generation:0,dropped:0,pending:0,messages:[]};
const messages=[];let bytes=0;
while(state.queue.length&&messages.length<maxMessages){
 const next=state.queue[0],trackedSize=Number(next&&next.size)||0;
 let size=0;
 try{const serialized=JSON.stringify(next&&next.message);size=(new TextEncoder()).encode(serialized).byteLength;}catch{}
 if(!next||!next.message||size<=0||size>2000000){state.queue.shift();state.bytes=Math.max(0,(Number(state.bytes)||0)-trackedSize);state.dropped=(Number(state.dropped)||0)+1;continue;}
 if(bytes+size>maxBytes)break;
 state.queue.shift();state.bytes=Math.max(0,(Number(state.bytes)||0)-trackedSize);
 messages.push(next.message);bytes+=size;
}
const dropped=Number(state.dropped)||0;state.dropped=0;
return {installed:state.installed===true,generation:Number(state.generation)||0,dropped,pending:state.queue.length,messages};
