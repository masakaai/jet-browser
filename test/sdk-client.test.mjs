import test from 'node:test';
import assert from 'node:assert/strict';
import {JetBrowser} from '../sdk/client.mjs';

test('server SDK routes sessions to an explicit regional pool',async()=>{
 const calls=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});return Response.json({id:'browser-1',region:'china'});};
 try{
  const client=new JetBrowser({apiKey:'msk_test',baseUrl:'https://api.example'});
  await client.create({region:'china'});
  assert.equal(JSON.parse(calls[0].options.body).region,'china');
  assert.throws(()=>client.create({region:'moon'}),/Unsupported browser region/);
 }finally{globalThis.fetch=original;}
});

test('SDK acquires an agent capability once and sends it with actions',async()=>{
 const calls=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(url.endsWith('/control'))return Response.json({mode:'agent',token:'agent-capability',epoch:1});if(url.endsWith('/commands'))return Response.json({id:'command-1',status:'queued'});return Response.json({id:'command-1',status:'completed',result:{ok:true}});};
 try{
  const client=new JetBrowser({apiKey:'msk_test',baseUrl:'https://api.example'});
  assert.deepEqual(await client.action('browser-1',{kind:'snapshot'}),{ok:true});
  assert.equal(calls.filter(call=>call.url.endsWith('/control')).length,1);
  const action=calls.find(call=>call.url.endsWith('/commands'));assert.equal(action.options.headers['X-Masaka-Control'],'agent-capability');
 }finally{globalThis.fetch=original;}
});

test('concurrent first actions share one control acquisition',async()=>{
 const calls=[],original=globalThis.fetch;let releaseControl;
 const controlReady=new Promise(resolve=>{releaseControl=resolve;});
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('/control')){await controlReady;return Response.json({mode:'agent',token:'shared-capability',epoch:1});}
  if(url.endsWith('/commands'))return Response.json({id:`command-${calls.filter(call=>call.url.endsWith('/commands')).length}`,status:'queued'});
  return Response.json({status:'completed',result:{ok:true}});
 };
 try{
  const client=new JetBrowser({apiKey:'msk_test',baseUrl:'https://api.example'});
  const first=client.snapshot('browser-1'),second=client.evaluate('browser-1','document.title');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(call=>call.url.endsWith('/control')).length,1);
  releaseControl();
  await Promise.all([first,second]);
  assert.equal(calls.filter(call=>call.url.endsWith('/control')).length,1);
  assert.ok(calls.filter(call=>call.url.endsWith('/commands')).every(call=>call.options.headers['X-Masaka-Control']==='shared-capability'));
 }finally{globalThis.fetch=original;}
});

test('explicit control replacement fences an older acquisition response',async()=>{
 const original=globalThis.fetch;let finish;
 globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
 try{
  const client=new JetBrowser({apiKey:'msk_test',baseUrl:'https://api.example'});
  const pending=client.acquire('browser-1');
  client.setControlToken('browser-1','new-explicit-capability');
  finish(Response.json({mode:'agent',token:'stale-capability',epoch:1}));
  await pending;
  assert.equal(client.controls.get('browser-1'),'new-explicit-capability');
 }finally{globalThis.fetch=original;}
});

test('server SDK exposes real browser tab commands',async()=>{
 const sent=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(url.endsWith('/control'))return Response.json({mode:'agent',token:'agent-capability',epoch:1});
  if(url.endsWith('/commands')){sent.push(JSON.parse(options.body));return Response.json({id:`command-${sent.length}`});}
  return Response.json({status:'completed',result:{tabs:[{handle:'page-one'}],active_tab:'page-one'}});
 };
 try{
  const browser=new JetBrowser({apiKey:'msk_test',baseUrl:'https://api.example'});
  await browser.control('browser-1');
  await browser.tabs('browser-1');
  await browser.newTab('browser-1');
  await browser.switchTab('browser-1','page-one');
  await browser.closeTab('browser-1','page-two');
  assert.deepEqual(sent,[{kind:'tabs'},{kind:'tab_new'},{kind:'tab_switch',handle:'page-one'},{kind:'tab_close',handle:'page-two'}]);
  assert.throws(()=>browser.control('browser-1','human'),/agent control/);
 }finally{globalThis.fetch=original;}
});
