import test from 'node:test';
import assert from 'node:assert/strict';
import {commandEpoch,fencedLookup} from '../src/control-command.mjs';

test('the first database controller adopts its epoch only without a direct input owner',()=>{
 const control={controlEpoch:0,clients:new Set()};
 assert.equal(commandEpoch(control,{control_epoch:7}),7);
 assert.equal(control.controlEpoch,7);
 const connected={controlEpoch:0,clients:new Set([{masaka:{claims:{scope:'input'}}}])};
 assert.equal(commandEpoch(connected,{control_epoch:9}),9);
 assert.equal(connected.controlEpoch,0);
});

test('a lookup-backed secret action is rejected when control changes during lookup',async()=>{
 let epoch=3,releaseLookup,executed=false;
 const lookup=new Promise(resolve=>{releaseLookup=resolve;});
 const operation=fencedLookup(()=>lookup,()=>{executed=true;},()=>{if(epoch!==3)throw Error('Stale browser control ticket');});
 epoch=4;releaseLookup({secret:'never-used'});
 await assert.rejects(operation,/Stale browser control ticket/);
 assert.equal(executed,false);
});
