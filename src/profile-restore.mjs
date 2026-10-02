import {cacheOnlyState,markProfileStateRestored,profileStateForRestore,shouldApplyWpeState} from './wpe-profile-state.mjs';
import {beginNavigationWithWait} from './engine-start.mjs';

export function requireProfileOrigin(actual,target){
 const actualOrigin=new URL(actual).origin,targetOrigin=new URL(target).origin;
 if(actualOrigin!==targetOrigin)throw Error('Browser profile restore redirected away from its saved origin');
 return actualOrigin;
}

export async function applyPortableProfile(engine,state,tracker,stateURL=null,{pause,timeoutMs=45000,navigate=beginNavigationWithWait}={}){
 if(!state)return false;
 const actualURL=await engine.url(),targetURL=stateURL||actualURL;
 if(!['http:','https:'].includes(new URL(actualURL).protocol))return false;
 requireProfileOrigin(actualURL,targetURL);
 const value=profileStateForRestore(state,targetURL,tracker),hasCache=value?.cache_storage?.length||value?.restore?.cache_storage===true;
 if(!shouldApplyWpeState(value))return false;
 const expectedOrigin=new URL(targetURL).origin;
 await engine.importState(value,expectedOrigin);
 const navigated=await navigate(engine,targetURL,{timeoutMs,...(pause?{pause}:{})});
 const landed=String(navigated?.url||await engine.url());
 // CacheStorage is origin-bound. Never replay saved cache entries into a
 // redirect destination selected by the remote site.
 requireProfileOrigin(landed,targetURL);
 if(hasCache)await engine.importState(cacheOnlyState(value),expectedOrigin);
 markProfileStateRestored(tracker,targetURL,value);
 return true;
}
