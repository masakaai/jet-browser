// A leading dot is the portable-state marker for a domain cookie. A domain
// without it is host-only and must never be offered to sibling subdomains.
const cookieMatches=(domain,host)=>{const raw=String(domain||'').toLowerCase(),value=raw.replace(/^\./,'');return raw.startsWith('.')?(host===value||host.endsWith('.'+value)):host===value;};
const pathMatches=(cookiePath,requestPath)=>{const value=String(cookiePath||'/');return requestPath===value||requestPath.startsWith(value.endsWith('/')?value:value+'/');};
const cookieVisible=(cookie,location)=>cookieMatches(cookie.domain,location.hostname)&&pathMatches(cookie.path,location.pathname||'/')&&(!cookie.secure||location.protocol==='https:');
const fromWpeCookie=(cookie,captureRevision)=>({name:String(cookie.name),value:String(cookie.value),domain:String(cookie.domain),path:String(cookie.path||'/'),expires:Number(cookie.expiry??-1),httpOnly:!!cookie.httpOnly,secure:!!cookie.secure,sameSite:cookie.sameSite||'Lax',...(captureRevision?{revision:captureRevision}:{})});
export const cookieKey=cookie=>`${String(cookie.name)}\n${String(cookie.domain).toLowerCase()}\n${String(cookie.path||'/')}`;
const cookieDeletion=(cookie,captureRevision)=>({name:String(cookie.name),domain:String(cookie.domain),path:String(cookie.path||'/'),secure:!!cookie.secure,revision:captureRevision});
const toWpeCookie=cookie=>{const domain=String(cookie.domain),value={name:String(cookie.name),value:String(cookie.value),path:String(cookie.path||'/'),httpOnly:!!cookie.httpOnly,secure:!!cookie.secure,sameSite:cookie.sameSite||'Lax'};if(domain.startsWith('.'))value.domain=domain;if(Number(cookie.expires)>0)value.expiry=Math.floor(Number(cookie.expires));return value;};
const revision=value=>Number.isSafeInteger(value)&&value>0?value:0;
export const normalizeProfileState=value=>({nativeRevision:revision(value?.nativeRevision),cookieRevision:revision(value?.cookieRevision),cookies:Array.isArray(value?.cookies)?value.cookies:[],cookieDeletions:Array.isArray(value?.cookieDeletions)?value.cookieDeletions:[],origins:Array.isArray(value?.origins)?value.origins:[]});
export function overlayNewerProfileSummary(bundle,summary){
 const detailed=normalizeProfileState(bundle),fresh=normalizeProfileState(summary),cookies=fresh.cookieRevision>detailed.cookieRevision?fresh:detailed,origins=new Map(detailed.origins.map(origin=>[origin.origin,origin]));
 for(const current of fresh.origins){
  const saved=origins.get(current.origin);
  if(revision(current.revision)<=revision(saved?.revision))continue;
  origins.set(current.origin,{...saved,...current,localStorage:current.localStorage||[],sessionStorage:saved?.sessionStorage||[],indexedDB:saved?.indexedDB||[],cacheStorage:saved?.cacheStorage||[]});
 }
 return {...detailed,nativeRevision:Math.max(detailed.nativeRevision,fresh.nativeRevision),cookieRevision:cookies.cookieRevision,cookies:cookies.cookies,cookieDeletions:cookies.cookieDeletions,origins:[...origins.values()]};
}
export function mergeWpeState(state,url,current,captureRevision=0){
 const value=normalizeProfileState(state),location=new URL(url),prior=value.origins.find(item=>item.origin===location.origin);
 const currentRevision=revision(captureRevision),captured=(current.cookies||[]).map(cookie=>fromWpeCookie(cookie,currentRevision)),capturedKeys=new Set(captured.map(cookieKey));
 const deleted=value.cookies.filter(cookie=>cookieVisible(cookie,location)&&!capturedKeys.has(cookieKey(cookie))).map(cookie=>cookieDeletion(cookie,currentRevision));
 const replacedKeys=new Set([...captured,...deleted].map(cookieKey));
 return {...value,cookieRevision:currentRevision||value.cookieRevision,cookies:[...value.cookies.filter(cookie=>!cookieVisible(cookie,location)),...captured],cookieDeletions:[...value.cookieDeletions.filter(cookie=>!replacedKeys.has(cookieKey(cookie))),...deleted],origins:[...value.origins.filter(item=>item.origin!==location.origin),{...prior,...(currentRevision?{revision:currentRevision}:{}),origin:location.origin,localStorage:(current.local_storage||[]).map(item=>({name:String(item.name),value:String(item.value)})),sessionStorage:Array.isArray(current.session_storage)?current.session_storage.map(item=>({name:String(item.name),value:String(item.value)})):prior?.sessionStorage||[],indexedDB:Array.isArray(current.indexed_db)?current.indexed_db:prior?.indexedDB||[],cacheStorage:Array.isArray(current.cache_storage)?current.cache_storage:prior?.cacheStorage||[]}]};
}
export function stateForWpe(state,url,{nativeRestored=false}={}){
 const value=normalizeProfileState(state),location=new URL(url),origin=value.origins.find(item=>item.origin===location.origin);
 // Native WPE archives preserve engine-private state, but some releases do
 // not reliably restore web storage. A captured portable origin is therefore
 // the authoritative overlay even when it has the same revision as the
 // archive. Replaying cookies and tombstones is idempotent and also repairs
 // archives produced by an older engine build without touching other origins.
 const originSelected=Boolean(origin),cookies=value.cookies.filter(cookie=>cookieMatches(cookie.domain,location.hostname)&&(!cookie.secure||location.protocol==='https:')).map(toWpeCookie),deletedCookies=value.cookieDeletions.filter(cookie=>cookieVisible(cookie,location)).map(cookie=>({name:String(cookie.name),domain:String(cookie.domain),path:String(cookie.path||'/')}));
 const result={cookies,local_storage:origin?.localStorage||[],session_storage:origin?.sessionStorage||[],indexed_db:origin?.indexedDB||[],cache_storage:origin?.cacheStorage||[]};
 if(deletedCookies.length)result.deleted_cookies=deletedCookies;
 if(nativeRestored)result.restore={cookies:false,local_storage:originSelected,session_storage:originSelected,indexed_db:originSelected,cache_storage:originSelected};
 return result;
}
export function cacheOnlyState(state){return {cookies:[],local_storage:[],session_storage:[],indexed_db:[],cache_storage:state.cache_storage||[],restore:{cookies:false,local_storage:false,session_storage:false,indexed_db:false,cache_storage:true}};}
export function shouldApplyWpeState(state){
 if(!state)return false;
 const hasData=['cookies','deleted_cookies','local_storage','session_storage','indexed_db','cache_storage'].some(key=>Array.isArray(state[key])&&state[key].length);
 const hasAuthoritativeEmpty=state.restore&&Object.entries(state.restore).some(([key,selected])=>key!=='session_storage'&&selected===true);
 return Boolean(hasData||hasAuthoritativeEmpty);
}
const restoreSets=tracker=>tracker instanceof Set?{origins:tracker,deletions:new Set()}:{origins:tracker?.origins||new Set(),deletions:tracker?.deletions||new Set()};
export function profileStateForRestore(state,url,tracker,{nativeRestored=false}={}){
 if(!state)return null;
 const location=new URL(url);if(!['http:','https:'].includes(location.protocol))return null;
 const sets=restoreSets(tracker),value=stateForWpe(state,location.href,{nativeRestored}),deleted=(value.deleted_cookies||[]).filter(cookie=>!sets.deletions.has(cookieKey(cookie)));
 if(!sets.origins.has(location.origin))return {...value,...(deleted.length?{deleted_cookies:deleted}:{deleted_cookies:undefined})};
 const result={cookies:[],local_storage:[],session_storage:[],indexed_db:[],cache_storage:[],...(deleted.length?{deleted_cookies:deleted}:{})};
 if(nativeRestored)result.restore={cookies:false,local_storage:false,session_storage:false,indexed_db:false,cache_storage:false};
 return result;
}
export function markProfileStateRestored(tracker,url,applied){
 const location=new URL(url),sets=restoreSets(tracker);sets.origins.add(location.origin);for(const cookie of applied?.deleted_cookies||[])sets.deletions.add(cookieKey(cookie));
}
export function profileOriginNeedsRestore(state,url,tracker,{nativeRestored=false}={}){
 return shouldApplyWpeState(profileStateForRestore(state,url,tracker,{nativeRestored}));
}
