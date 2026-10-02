import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeProfileState,encodeProfileState} from '../src/profile-state-bundle.mjs';

const user='11111111-1111-4111-8111-111111111111',profile='22222222-2222-4222-8222-222222222222';
test('profile state bundle is compressed, encrypted and bound to owner/profile',()=>{const old=process.env.VAULT_ENCRYPTION_KEY;process.env.VAULT_ENCRYPTION_KEY='42'.repeat(32);try{const state={cookies:[{name:'sid',value:'plaintext-marker'}],origins:[{origin:'https://example.com',indexedDB:[{name:'db',records:Array.from({length:100},(_,id)=>({id,value:'repeat'.repeat(20)}))}]}]},bundle=encodeProfileState(state,user,profile);assert.equal(bundle.includes(Buffer.from('plaintext-marker')),false);assert.deepEqual(decodeProfileState(bundle,user,profile),state);assert.throws(()=>decodeProfileState(bundle,user,'33333333-3333-4333-8333-333333333333'));}finally{if(old===undefined)delete process.env.VAULT_ENCRYPTION_KEY;else process.env.VAULT_ENCRYPTION_KEY=old;}});
