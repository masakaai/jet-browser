import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {WpeClient} from '../src/wpe-client.mjs';

function fakeChild(){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;}
test('download launch token rejects paths before writing and is forwarded only when supplied',async()=>{
 let autoRespond=true;
 const child=fakeChild(),client=new WpeClient(child),written=[];child.stdin.on('data',data=>{written.push(String(data));if(autoRespond)queueMicrotask(()=>child.stdout.write('{"ok":true,"value":{"sessionId":"unexpected"}}\n'));});
 try{
  for(const downloadToken of ['../escape','',null,'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA','aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa'])await assert.rejects(client.create({downloadToken}),/token/i);
  assert.equal(written.length,0);
  autoRespond=false;
  const downloadToken='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const created=client.create({downloadToken});
  assert.equal(JSON.parse(written[0]).download_token,downloadToken);
  child.stdout.write('{"ok":true,"value":{"sessionId":"download-session"}}\n');await created;
 }finally{client.closed=true;client.lines.close();}
});
test('WPE client frames commands and resolves matching JSONL responses',async()=>{
 const child=fakeChild(),client=new WpeClient(child),written=[];child.stdin.on('data',data=>written.push(String(data)));
 const result=client.create({proxy:'http://127.0.0.1:4000',profileDir:'/var/lib/masaka/profiles/a/b'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(written.join('').trim()),{op:'create',proxy:'http://127.0.0.1:4000',profile_dir:'/var/lib/masaka/profiles/a/b',page_load_strategy:'eager'});
 child.stdout.write('{"ok":true,"value":{"sessionId":"one"}}\n');assert.deepEqual(await result,{sessionId:'one'});
 client.closed=true;client.lines.close();
});
test('browser creation uses a bounded failover timeout',async()=>{
 const child=fakeChild(),client=new WpeClient(child);let observed;
 client.command=async(value,timeout)=>{observed={value,timeout};return {sessionId:'bounded'};};
 assert.equal((await client.create()).sessionId,'bounded');assert.equal(observed.value.op,'create');assert.equal(observed.timeout,15000);client.closed=true;client.lines.close();
});
test('WPE client rejects structured engine errors',async()=>{
 const child=fakeChild(),client=new WpeClient(child),result=client.input([{type:'release'}]);
 child.stdout.write('{"ok":false,"error":"bad input"}\n');await assert.rejects(result,/bad input/);client.closed=true;client.lines.close();
});
test('driver transport failures require a fresh WebDriver slot',async()=>{
 const child=fakeChild(),client=new WpeClient(child);const pending=client.title();
 child.stdout.write('{"ok":false,"error":"Driver transport failed"}\n');
 await assert.rejects(pending,error=>error.driverRestartRequired===true);
 client.closed=true;client.lines.close();
});
test('evaluation uses a typed expression command and preserves the real remote result',async()=>{
 const child=fakeChild(),client=new WpeClient(child),written=[];child.stdin.on('data',data=>written.push(String(data)));
 const result=client.evaluate('document.title');
 assert.deepEqual(JSON.parse(written.join('').trim()),{op:'evaluate',expression:'document.title'});
 child.stdout.write(JSON.stringify({ok:true,value:{result:{type:'string',value:'Actual title'}}})+'\n');
 assert.deepEqual(await result,{result:{type:'string',value:'Actual title'}});client.closed=true;client.lines.close();
});
test('initial navigation uses a nonblocking typed command',async()=>{
 const child=fakeChild(),client=new WpeClient(child),written=[];child.stdin.on('data',data=>written.push(String(data)));
 const result=client.beginNavigation('https://example.com/path');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(written.shift()),{op:'begin_navigation',url:'https://example.com/path'});
 child.stdout.write('{"ok":true,"value":{"started":true}}\n');assert.deepEqual(await result,{started:true});client.closed=true;client.lines.close();
});
test('visual change probes use a bounded typed command',async()=>{
 const child=fakeChild(),client=new WpeClient(child),written=[];child.stdin.on('data',data=>written.push(String(data)));
 const result=client.visualState();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(written.shift()),{op:'visual_state'});
 child.stdout.write('{"ok":true,"value":{"url":"https://example.com/","title":"Example","timeOrigin":1,"revision":2}}\n');
 assert.equal((await result).revision,2);client.closed=true;client.lines.close();
});
test('browser tabs use typed window-handle commands',async()=>{
 const child=fakeChild(),client=new WpeClient(child),written=[];child.stdin.on('data',data=>written.push(String(data)));
 const handles=client.windowHandles();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(JSON.parse(written.shift()),{op:'window_handles'});child.stdout.write('{"ok":true,"value":["page-one"]}\n');assert.deepEqual(await handles,['page-one']);
 const switched=client.switchWindow('page-two');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(JSON.parse(written.shift()),{op:'switch_window',handle:'page-two'});child.stdout.write('{"ok":true,"value":null}\n');await switched;
 const created=client.newWindow();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(JSON.parse(written.shift()),{op:'new_window',kind:'tab'});child.stdout.write('{"ok":true,"value":{"handle":"page-three","type":"window"}}\n');assert.equal((await created).handle,'page-three');
 const closed=client.closeWindow();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(JSON.parse(written.shift()),{op:'close_window'});child.stdout.write('{"ok":true,"value":["page-one"]}\n');await closed;client.closed=true;client.lines.close();
});
test('compositor screenshots use the independent capture plane',async()=>{
 const child=fakeChild(),client=new WpeClient(child,'http://127.0.0.1:9515','http://127.0.0.1:9615'),prior=globalThis.fetch,requests=[];
 globalThis.fetch=async url=>{requests.push(String(url));return {ok:true,arrayBuffer:async()=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(1200)]).buffer};};
 try{const frame=Buffer.from(await client.compositorScreenshot(),'base64');assert.ok(frame.length>1000);assert.deepEqual(requests,['http://127.0.0.1:9615/capture']);}
 finally{globalThis.fetch=prior;client.closed=true;client.lines.close();}
});
test('semantic preview uses dedicated typed commands',async()=>{
 const child=fakeChild(),client=new WpeClient(child),written=[];child.stdin.on('data',data=>written.push(String(data)));
 const injected=client.injectSemantic('return true;');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(written.shift()),{op:'inject_semantic',source:'return true;'});child.stdout.write('{"ok":true,"value":{"installed":true}}\n');await injected;
 const drained=client.drainSemantic(120000,12);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(written.shift()),{op:'drain_semantic',max_bytes:120000,max_messages:12});child.stdout.write('{"ok":true,"value":{"messages":[]}}\n');await drained;
 const controlled=client.semanticControl('dash:dom-stream-start',{trigger:'test'});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(JSON.parse(written.shift()),{op:'semantic_control',type:'dash:dom-stream-start',payload:{trigger:'test'}});child.stdout.write('{"ok":true,"value":{"applied":true}}\n');await controlled;
 client.closed=true;client.lines.close();
});
test('WPE client contains child stdin pipe failures and rejects the pending command',async()=>{
 const child=fakeChild();child.stdin=new Writable({write(_chunk,_encoding,done){done(Object.assign(new Error('write EPIPE'),{code:'EPIPE'}));}});
 const client=new WpeClient(child);
 await assert.rejects(client.screenshot(),/EPIPE/);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(client.closed,true);client.lines.close();
});
test('deadline abort kills the engine and rejects an in-flight command',async()=>{
 const child=fakeChild();let signal=null;child.kill=value=>{signal=value;};const client=new WpeClient(child),pending=client.screenshot();
 client.abort();await assert.rejects(pending,/deadline exceeded/);assert.equal(client.closed,true);assert.equal(signal,'SIGKILL');client.lines.close();
});
test('a command timeout immediately closes and kills the bridge',async()=>{
 const child=fakeChild();let signal=null;child.kill=value=>{signal=value;};const client=new WpeClient(child);
 await assert.rejects(client.command({op:'screenshot'},5),error=>/WPE screenshot command timed out/.test(error.message)&&error.driverRestartRequired===true);
 assert.equal(client.closed,true);assert.equal(signal,'SIGKILL');client.lines.close();
});
test('an ambiguous create transport failure marks the driver slot unsafe',async()=>{
 const child=fakeChild(),client=new WpeClient(child);const pending=client.create();child.emit('exit',1);await assert.rejects(pending,error=>error.driverReusable===false);client.lines.close();
});
test('engine exit marks ordinary pending commands for driver restart',async()=>{
 const child=fakeChild(),client=new WpeClient(child),pending=client.title();child.emit('exit',1);
 await assert.rejects(pending,error=>error.driverRestartRequired===true);
 await assert.rejects(client.url(),error=>error.driverRestartRequired===true);
 client.lines.close();
});
test('an ambiguous create failure reported by the Rust bridge quarantines the driver slot',async()=>{
 const child=fakeChild(),client=new WpeClient(child);const pending=client.create();child.stdout.write('{"ok":false,"error":"Unsafe driver creation: Driver transport failed"}\n');await assert.rejects(pending,error=>error.driverReusable===false);client.closed=true;client.lines.close();
});
test('orphan cleanup targets the assigned driver slot',async()=>{
 const child=fakeChild(),client=new WpeClient(child,'http://127.0.0.1:9516'),prior=globalThis.fetch,requests=[];client.sessionId='slot-two';globalThis.fetch=async url=>{requests.push(String(url));return {ok:true};};
 try{child.emit('exit',1);await client.close();assert.deepEqual(requests,['http://127.0.0.1:9516/session/slot-two']);}finally{globalThis.fetch=prior;client.lines.close();}
});
test('failed close deletes the driver session before releasing the slot',async()=>{
 const child=fakeChild(),client=new WpeClient(child,'http://127.0.0.1:9516'),prior=globalThis.fetch,requests=[];client.sessionId='failed-close';globalThis.fetch=async url=>{requests.push(String(url));return {ok:true};};
 try{const closing=client.close();child.stdout.write('{"ok":false,"error":"close failed"}\n');await assert.rejects(closing,/close failed/);assert.deepEqual(requests,['http://127.0.0.1:9516/session/failed-close']);assert.equal(client.sessionId,null);}finally{globalThis.fetch=prior;client.lines.close();}
});
test('failed orphan deletion keeps the session id so cleanup can be retried',async()=>{
 const child=fakeChild(),client=new WpeClient(child,'http://127.0.0.1:9516'),prior=globalThis.fetch;client.sessionId='retry-close';let calls=0;globalThis.fetch=async()=>({ok:++calls>3,status:503});
 try{await assert.rejects(client.cleanupOrphan(),/503/);assert.equal(client.sessionId,'retry-close');await client.cleanupOrphan();assert.equal(client.sessionId,null);assert.equal(calls,4);}finally{globalThis.fetch=prior;client.closed=true;client.lines.close();}
});
