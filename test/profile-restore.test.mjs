import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPortableProfile} from '../src/profile-restore.mjs';

test('cache state is never replayed after the saved origin redirects elsewhere',async()=>{
 const imported=[];
 const engine={url:async()=> 'https://saved.example/start',importState:async value=>imported.push(value)};
 const state={cookies:[],cookieDeletions:[],origins:[{origin:'https://saved.example',cacheStorage:[{name:'cache',entries:[]}]}]};
 await assert.rejects(applyPortableProfile(engine,state,{origins:new Set(),deletions:new Set()},null,{navigate:async()=>({url:'https://attacker.example/landing'})}),/redirected away/);
 assert.equal(imported.length,1);
 assert.equal(imported[0].cache_storage.length,1);
});
