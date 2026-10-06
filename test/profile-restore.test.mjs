import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPortableProfile,replayPortableCache} from '../src/profile-restore.mjs';

test('cache state is never replayed after the saved origin redirects elsewhere',async()=>{
 const imported=[];
 const engine={url:async()=> 'https://saved.example/start',importState:async(value,expectedOrigin)=>imported.push({value,expectedOrigin})};
 const state={cookies:[],cookieDeletions:[],origins:[{origin:'https://saved.example',cacheStorage:[{name:'cache',entries:[]}]}]};
 await assert.rejects(applyPortableProfile(engine,state,{origins:new Set(),deletions:new Set()},null,{navigate:async()=>({url:'https://attacker.example/landing'})}),/redirected away/);
 assert.equal(imported.length,1);
 assert.equal(imported[0].value.cache_storage.length,1);
 assert.equal(imported[0].expectedOrigin,'https://saved.example');
});

test('every portable import is fenced to the saved origin inside the browser',async()=>{
 const imported=[];
 const engine={url:async()=> 'https://saved.example/start',importState:async(value,expectedOrigin)=>imported.push({value,expectedOrigin})};
 const state={cookies:[],cookieDeletions:[],origins:[{origin:'https://saved.example',cacheStorage:[{name:'cache',entries:[]}]}]};
 await applyPortableProfile(engine,state,{origins:new Set(),deletions:new Set()},null,{navigate:async()=>({url:'https://saved.example/home'})});
 assert.equal(imported.length,2);
 assert.deepEqual(imported.map(item=>item.expectedOrigin),['https://saved.example','https://saved.example']);
});

test('final navigation can replay only the saved cache without navigating again',async()=>{
 const imported=[];const engine={url:async()=> 'https://saved.example/home',importState:async(value,expectedOrigin)=>imported.push({value,expectedOrigin})};
 const state={cookies:[{name:'sid'}],origins:[{origin:'https://saved.example',localStorage:[{name:'token',value:'keep'}],cacheStorage:[{name:'offline',entries:[]}]}]};
 assert.equal(await replayPortableCache(engine,state,'https://saved.example/home'),true);assert.equal(imported.length,1);assert.deepEqual(imported[0],{value:{cookies:[],local_storage:[],session_storage:[],indexed_db:[],cache_storage:[{name:'offline',entries:[]}],restore:{cookies:false,local_storage:false,session_storage:false,indexed_db:false,cache_storage:true}},expectedOrigin:'https://saved.example'});
});
