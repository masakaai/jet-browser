const state=window.__masakaSemanticV1,type=arguments[0],handle=window.__phantomStreamHandleControl;
if(!state||state.version!==1)return {applied:false,generation:state&&Number(state.generation)||0};
if(type==='dash:dom-stream-start'){
 if(typeof window.__phantomStreamStart!=='function')return {applied:false,generation:Number(state.generation)||0};
 state.queue=[];state.bytes=0;
 window.__phantomStreamStart();
}else{
 if(typeof handle!=='function')return {applied:false,generation:Number(state.generation)||0};
 handle(type,arguments[1]||{});
}
return {applied:true,generation:Number(state.generation)||0};
