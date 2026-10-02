import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPortableProfile} from '../src/profile-restore.mjs';

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
