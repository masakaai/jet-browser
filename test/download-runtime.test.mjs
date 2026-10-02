import test from 'node:test';
import assert from 'node:assert/strict';
import {startDownloadRuntime} from '../src/download-runtime.mjs';
const session={id:'649ab2c8-a444-4a22-8444-123456789abc',user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',project_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
function fixture(overrides={}){
 const calls=[];const engine={sessionId:null,async create(options){calls.push(['create',options]);this.sessionId='native-session';},async close(){calls.push(['close']);this.sessionId=null;},...overrides};
 return {engine,calls,options:{session,worker:'fixture',rpc:async()=>{},engineFactory:()=>engine,proxy:'http://127.0.0.1:4000',profileDir:'/var/lib/masaka/profiles/test',waitReady:async root=>{calls.push(['ready',root]);return {ready:true,text:'ready\n'};}}};
}
test('download startup creates once, preserves proxy/profile and waits for native readiness',async()=>{
 const f=fixture();const runtime=await startDownloadRuntime(f.options);
 assert.equal(runtime.engine,f.engine);assert.deepEqual(f.calls.map(x=>x[0]),['create','ready']);
 assert.equal(f.calls[0][1].proxy,f.options.proxy);assert.equal(f.calls[0][1].profileDir,f.options.profileDir);
 assert.equal(f.calls[1][1],'/var/lib/masaka-downloads/'+f.calls[0][1].downloadToken);
 await runtime.publisher.close();await f.engine.close();
});
test('unknown create outcome is never retried and quarantines even if close has no known session',async()=>{
 const f=fixture({async create(){f.calls.push(['create']);throw Error('transport lost');}});
 await assert.rejects(startDownloadRuntime(f.options),error=>error.driverReusable===false&&/transport lost/.test(error.message));
 assert.deepEqual(f.calls.map(x=>x[0]),['create','close']);
});
test('ready failure frees driver only after a known created session is confirmed closed',async()=>{
 const f=fixture();f.options.waitReady=async()=>{throw Error('not ready');};
 await assert.rejects(startDownloadRuntime(f.options),error=>error.driverReusable===true);
 const bad=fixture({async close(){throw Error('close unknown');}});bad.options.waitReady=f.options.waitReady;
 await assert.rejects(startDownloadRuntime(bad.options),error=>error.driverReusable===false);
});
test('invalid account binding fails before constructing an engine',async()=>{
 const f=fixture();let constructions=0;f.options.engineFactory=()=>{constructions++;return f.engine;};
 await assert.rejects(startDownloadRuntime({...f.options,session:{...session,user_id:'bad'}}));assert.equal(constructions,0);
});
