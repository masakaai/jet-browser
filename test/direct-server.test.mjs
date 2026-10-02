import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acknowledgeSemantic,DIRECT_ACTION_TYPES,expectSemanticAcknowledgement,queueSemanticControl,requireFreshInputTicket} from '../src/direct-server.mjs';

test('direct input protocol includes real browser tab lifecycle actions',()=>{
 assert.deepEqual([...DIRECT_ACTION_TYPES],['input','navigate','tab-switch','tab-new','tab-close']);
});

test('semantic snapshots remain pending until the viewer acknowledges the envelope',async()=>{
 const control={};
 const receipt=expectSemanticAcknowledgement(control,'abcdefghijklmnopqrst',1000);
 assert.equal(acknowledgeSemantic(control,'abcdefghijklmnopqrst'),true);
 assert.equal(await receipt.promise,true);
 assert.equal(control.semanticAcknowledgements.size,0);
 assert.equal(acknowledgeSemantic(control,'abcdefghijklmnopqrst'),false);
});

test('cancelling an unshipped semantic snapshot releases its receipt',async()=>{
 const control={};
 const receipt=expectSemanticAcknowledgement(control,'12345678901234567890',1000);
 receipt.cancel();
 assert.equal(await receipt.promise,false);
 assert.equal(control.semanticAcknowledgements.size,0);
});

test('full DOM resync requests coalesce while a snapshot is generating or awaiting delivery',()=>{
 const control={semanticControls:[],semanticControlBytes:0,semanticBacklog:[],semanticPriming:true};
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'during-prime'}),false);
 control.semanticPriming=false;
 control.semanticBacklog=[{type:'ext:dom-snapshot',payload:{}}];
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'during-delivery'}),false);
 control.semanticBacklog=[];
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'fresh'}),true);
 assert.equal(queueSemanticControl(control,'dash:dom-stream-start',{trigger:'duplicate'}),false);
 assert.equal(control.semanticControls.length,1);
});

test('input expiry is rechecked after beginInput reaches the dispatch boundary',()=>{
 const state={claims:{scope:'input',epoch:4,exp:100},control:{controlEpoch:4}};
 assert.doesNotThrow(()=>requireFreshInputTicket(state,100));
 assert.throws(()=>requireFreshInputTicket(state,101),/expired/);
 const source=readFileSync(new URL('../src/direct-server.mjs',import.meta.url),'utf8');
 assert.match(source,/await state\.control\.beginInput\?\.\(\);[\s\S]{0,300}requireFreshInputTicket\(state\)/);
});
