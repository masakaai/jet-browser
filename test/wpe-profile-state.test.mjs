import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheOnlyState,markProfileStateRestored,mergeWpeState,normalizeProfileState,profileOriginNeedsRestore,profileStateForRestore,shouldApplyWpeState,stateForWpe} from '../src/wpe-profile-state.mjs';
test('WPE state round-trips through Playwright-compatible cookie and origin fields',()=>{
 const current={cookies:[{name:'sid',value:'one',domain:'.example.com',path:'/',expiry:1800000000,httpOnly:true,secure:true,sameSite:'Strict'}],local_storage:[{name:'token',value:'v1'}]};
 const state=mergeWpeState(normalizeProfileState(),'https://app.example.com/page',current);assert.deepEqual(state.origins,[{origin:'https://app.example.com',localStorage:[{name:'token',value:'v1'}],sessionStorage:[],indexedDB:[],cacheStorage:[]}]);
 assert.deepEqual(stateForWpe(state,'https://app.example.com/'),{cookies:[{name:'sid',value:'one',domain:'.example.com',path:'/',httpOnly:true,secure:true,sameSite:'Strict',expiry:1800000000}],local_storage:[{name:'token',value:'v1'}],session_storage:[],indexed_db:[],cache_storage:[]});
 assert.equal(stateForWpe(state,'http://app.example.com/').cookies.length,0);
});
test('updating one origin preserves other origins and indexedDB metadata',()=>{
 const initial={cookies:[],origins:[{origin:'https://one.example',localStorage:[],indexedDB:[{name:'db'}]},{origin:'https://two.example',localStorage:[{name:'keep',value:'yes'}]}]};
 const merged=mergeWpeState(initial,'https://one.example/',{cookies:[],local_storage:[{name:'now',value:'two'}]});assert.deepEqual(merged.origins.find(x=>x.origin==='https://one.example').indexedDB,[{name:'db'}]);assert.equal(merged.origins.find(x=>x.origin==='https://two.example').localStorage[0].value,'yes');
});
test('capture preserves cookies outside the current document visibility',()=>{
 const initial={cookies:[{name:'account',value:'keep',domain:'example.com',path:'/account',secure:false},{name:'secure',value:'keep',domain:'example.com',path:'/',secure:true},{name:'visible',value:'old',domain:'example.com',path:'/',secure:false}],origins:[]};
 const merged=mergeWpeState(initial,'http://example.com/',{cookies:[{name:'visible',value:'new',domain:'example.com',path:'/',secure:false}]});
 assert.deepEqual(merged.cookies.map(value=>[value.name,value.value]),[['account','keep'],['secure','keep'],['visible','new']]);
});
test('portable state repairs path cookies missing from a same-revision native archive',()=>{
 const initial={nativeRevision:1,cookieRevision:1,cookies:[{name:'admin_session',value:'keep',domain:'example.com',path:'/admin',secure:true,revision:1}],origins:[]};
 const captured=mergeWpeState(initial,'https://example.com/',{cookies:[],local_storage:[]},2),saved={...captured,nativeRevision:2};
 const restored=stateForWpe(saved,'https://example.com/admin',{nativeRestored:true});
 assert.equal(restored.restore.cookies,false);
 assert.equal(restored.cookies[0].name,'admin_session');
});
test('host-only cookies never leak to or get replaced by a subdomain capture',()=>{
 const initial={cookies:[{name:'host',value:'parent',domain:'example.com',path:'/',secure:true},{name:'domain',value:'shared',domain:'.example.com',path:'/',secure:true}],origins:[]};
 assert.deepEqual(stateForWpe(initial,'https://sub.example.com/').cookies,[{name:'domain',value:'shared',domain:'.example.com',path:'/',httpOnly:false,secure:true,sameSite:'Lax'}]);
 assert.deepEqual(stateForWpe(initial,'https://example.com/').cookies,[{name:'host',value:'parent',path:'/',httpOnly:false,secure:true,sameSite:'Lax'},{name:'domain',value:'shared',domain:'.example.com',path:'/',httpOnly:false,secure:true,sameSite:'Lax'}]);
 const merged=mergeWpeState(initial,'https://sub.example.com/',{cookies:[{name:'domain',value:'new',domain:'.example.com',path:'/',secure:true}]});
 assert.equal(merged.cookies.find(cookie=>cookie.name==='host').value,'parent');
 assert.equal(merged.cookies.find(cookie=>cookie.name==='domain').value,'new');
});
test('native restore always overlays captured portable origins',()=>{
 const state={nativeRevision:3,cookieRevision:4,cookies:[{name:'sid',value:'fresh',domain:'fresh.example',path:'/',secure:true,revision:4}],origins:[{origin:'https://fresh.example',revision:4,localStorage:[{name:'token',value:'fresh'}],sessionStorage:[{name:'draft',value:'yes'}]},{origin:'https://stale.example',revision:2,localStorage:[{name:'token',value:'stale'}],sessionStorage:[{name:'draft',value:'keep'}]}]};
 assert.equal(stateForWpe(state,'https://fresh.example/',{nativeRestored:true}).local_storage[0].value,'fresh');
 const stale=stateForWpe(state,'https://stale.example/',{nativeRestored:true});assert.equal(stale.local_storage[0].value,'stale');assert.equal(stale.session_storage[0].value,'keep');assert.deepEqual(stale.restore,{cookies:false,local_storage:true,session_storage:true,indexed_db:true,cache_storage:true});
});
test('portable cookie overlay remains available for every captured hostname',()=>{
 const initial={nativeRevision:1,cookieRevision:1,cookies:[{name:'sid',value:'old',domain:'a.example',path:'/',secure:true,revision:1}],origins:[]},saved=mergeWpeState(initial,'https://b.example/',{cookies:[],local_storage:[]},2);
 assert.equal(stateForWpe(saved,'https://a.example/',{nativeRestored:true}).cookies[0].value,'old');
 assert.equal(stateForWpe(saved,'https://b.example/',{nativeRestored:true}).restore.local_storage,true);
});
test('same-revision portable localStorage repairs an incomplete native archive',()=>{
 const state={nativeRevision:7,cookieRevision:7,cookies:[{name:'sid',value:'portable',domain:'app.example',path:'/',secure:true,revision:7}],origins:[{origin:'https://app.example',revision:7,localStorage:[{name:'token',value:'restored'}],sessionStorage:[],indexedDB:[],cacheStorage:[]}]};
 const restored=stateForWpe(state,'https://app.example/',{nativeRestored:true});
 assert.equal(restored.local_storage[0].value,'restored');
 assert.equal(restored.cookies[0].value,'portable');
 assert.deepEqual(restored.restore,{cookies:false,local_storage:true,session_storage:true,indexed_db:true,cache_storage:true});
});
test('cache-only replay cannot overwrite other browser state',()=>{
 const result=cacheOnlyState({cookies:[{name:'sid'}],local_storage:[{name:'token',value:'keep'}],indexed_db:[{name:'login'}],cache_storage:[{name:'offline',entries:[]}]});
 assert.deepEqual(result,{cookies:[],local_storage:[],session_storage:[],indexed_db:[],cache_storage:[{name:'offline',entries:[]}],restore:{cookies:false,local_storage:false,session_storage:false,indexed_db:false,cache_storage:true}});
});
test('authoritative empty portable state clears an older native profile',()=>{
 const value=stateForWpe({nativeRevision:2,cookieRevision:3,cookies:[],cookieDeletions:[{name:'sid',domain:'example.com',path:'/',secure:true,revision:3}],origins:[{origin:'https://example.com',revision:3,localStorage:[],sessionStorage:[],indexedDB:[],cacheStorage:[]}]},'https://example.com/',{nativeRestored:true});
 assert.equal(shouldApplyWpeState(value),true);
 assert.deepEqual(value.deleted_cookies,[{name:'sid',domain:'example.com',path:'/'}]);
 assert.equal(shouldApplyWpeState({cookies:[],local_storage:[],session_storage:[],indexed_db:[],cache_storage:[]}),false);
 assert.equal(shouldApplyWpeState({cookies:[],local_storage:[],session_storage:[],indexed_db:[],cache_storage:[],restore:{session_storage:true}}),false);
});
test('browser-driven navigation detects an unrestored portable origin',()=>{
 const state={nativeRevision:2,cookieRevision:3,cookies:[{name:'sid',value:'portable',domain:'account.example',path:'/',secure:true,revision:3}],origins:[{origin:'https://account.example',revision:3,localStorage:[{name:'token',value:'portable'}],sessionStorage:[],indexedDB:[],cacheStorage:[]}]};
 const restored=new Set(['https://start.example']);
 assert.equal(profileOriginNeedsRestore(state,'https://account.example/home',restored,{nativeRestored:true}),true);
 restored.add('https://account.example');
 assert.equal(profileOriginNeedsRestore(state,'https://account.example/next',restored,{nativeRestored:true}),false);
 assert.equal(profileOriginNeedsRestore(state,'https://unrelated.example/',restored,{nativeRestored:true}),false);
});
test('cookie capture emits scoped deletion tombstones without clearing hidden paths',()=>{
 const initial={nativeRevision:1,cookieRevision:1,cookies:[{name:'root',value:'old',domain:'example.com',path:'/',secure:true,revision:1},{name:'admin',value:'keep',domain:'example.com',path:'/admin',secure:true,revision:1}],origins:[]};
 const captured=mergeWpeState(initial,'https://example.com/',{cookies:[],local_storage:[]},2);
 const root=stateForWpe(captured,'https://example.com/',{nativeRestored:true}),admin=stateForWpe(captured,'https://example.com/admin',{nativeRestored:true});
 assert.deepEqual(root.deleted_cookies,[{name:'root',domain:'example.com',path:'/'}]);
 assert.equal(admin.deleted_cookies.some(cookie=>cookie.name==='admin'),false);
});
test('path-scoped deletions remain pending after another path on the origin is restored',()=>{
 const state={nativeRevision:1,cookies:[],cookieDeletions:[{name:'sid',domain:'example.com',path:'/account',secure:true,revision:2}],origins:[{origin:'https://example.com',revision:2,localStorage:[],sessionStorage:[],indexedDB:[],cacheStorage:[]}]},tracker={origins:new Set(),deletions:new Set()};
 const bootstrap=profileStateForRestore(state,'https://example.com/robots.txt',tracker,{nativeRestored:true});markProfileStateRestored(tracker,'https://example.com/robots.txt',bootstrap);
 assert.equal(profileOriginNeedsRestore(state,'https://example.com/account',tracker,{nativeRestored:true}),true);
 const account=profileStateForRestore(state,'https://example.com/account',tracker,{nativeRestored:true});assert.deepEqual(account.deleted_cookies,[{name:'sid',domain:'example.com',path:'/account'}]);markProfileStateRestored(tracker,'https://example.com/account',account);
 assert.equal(profileOriginNeedsRestore(state,'https://example.com/account',tracker,{nativeRestored:true}),false);
});
