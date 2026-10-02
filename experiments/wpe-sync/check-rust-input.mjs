// End-to-end Rust input protocol -> authenticated SSH -> deeptensor WPE.
// The ephemeral loopback relay exists only for this check; no public driver port.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const wpeContainer=process.env.WPE_CONTAINER||'masaka-wpe-sync-spike';
async function remote(method,path,body){
 const args=['deeptensor','docker','exec','-i',wpeContainer,'curl','-sS','--max-time','35','-X',method,'-H','Content-Type:application/json'];
 if(body)args.push('--data-binary','@-');args.push('http://127.0.0.1:9515'+path);
 return new Promise((resolve,reject)=>{const p=spawn('ssh',args),out=[];p.stdout.on('data',b=>out.push(b));p.stderr.resume();p.on('error',reject);p.on('close',code=>code?reject(Error('SSH transport failed')):resolve(Buffer.concat(out)));p.stdin.end(body);});
}
const server=createServer(async(req,res)=>{
 if(req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host||'')||!/^\/session(?:\/[a-zA-Z0-9-]+(?:\/(?:timeouts|url|actions|screenshot|title|cookie|execute\/sync|element\/active|element\/[a-zA-Z0-9-]+\/value))?)?$/.test(req.url)||!['GET','POST','DELETE'].includes(req.method)){res.writeHead(403).end();return;}
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)throw Error('Body too large')};const payload=await remote(req.method,req.url,body);if(process.env.DEBUG_INPUT==='1')console.log('Relay',req.method,req.url,payload.length,req.url.endsWith('/actions')?body:'');res.setHeader('Content-Type','application/json');res.end(payload);}catch{res.writeHead(502).end('{}')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const child=process.env.RUST_REMOTE==='1'
 ?spawn('ssh',['deeptensor','docker','run','--rm','-i','--network','container:'+wpeContainer,'--memory=256m','--cpus=1','--entrypoint','/usr/local/bin/jet-wpe',process.env.RUST_IMAGE||'masaka-jet-wpe:0.2.0'],{stdio:['pipe','pipe','pipe']})
 :spawn('./target/debug/jet-wpe',[],{env:{PATH:process.env.PATH,WPE_WEBDRIVER_URL:'http://127.0.0.1:'+server.address().port},stdio:['pipe','pipe','pipe']});
child.stderr.resume();const lines=createInterface({input:child.stdout}),pending=[];let sid;
lines.on('line',s=>{const q=pending.shift();if(q){clearTimeout(q.timer);q.resolve(JSON.parse(s))}});
child.on('error',error=>{for(const q of pending.splice(0)){clearTimeout(q.timer);q.reject(error)}});
function command(value){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Rust command timeout')),60000);pending.push({resolve,reject,timer});child.stdin.write(JSON.stringify(value)+'\n')})}
async function ok(value){const r=await command(value);assert.equal(r.ok,true,JSON.stringify(r));return r.value;}
const execute=async script=>{const d=JSON.parse((await remote('POST','/session/'+sid+'/execute/sync',JSON.stringify({script,args:[]}))).toString());assert.equal(d.value?.error,undefined);return d.value;};
try{
 const s=await ok({op:'create',proxy:null,profile_dir:null});sid=s.sessionId;
 await ok({op:'navigate',url:'https://masaka-ai.vercel.app/browser-check.html'});
 assert.equal(await ok({op:'title'}),'MASAKA browser verification');
 await execute('window.__inputEvidence=[];for(const name of ["pointerdown","pointerup","mousedown","mouseup","click","keydown","keyup","wheel","input"]){document.addEventListener(name,e=>window.__inputEvidence.push({name,trusted:e.isTrusted,key:e.key||null,x:e.clientX,y:e.clientY,target:e.target.id}),true)}document.body.style.minHeight="3000px";return true;');
 const field=await execute('const r=document.querySelector("#value").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),viewport:{width:innerWidth,height:innerHeight}};');
 console.log('Measured WPE input geometry:',JSON.stringify(field));
 await ok({op:'input',events:[{type:'pointer',phase:'down',x:field.x,y:field.y,button:0},{type:'pointer',phase:'up',x:field.x,y:field.y,button:0}]});
 console.log('Pointer evidence:',JSON.stringify(await execute('return {events:window.__inputEvidence,active:document.activeElement.outerHTML.slice(0,160),dpr:devicePixelRatio,focus:document.hasFocus()}')));
 if(await execute('return document.activeElement.id')!=='value'){
  await remote('POST','/session/'+sid+'/actions',JSON.stringify({actions:[{type:'pointer',id:'diagnostic-pointer',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',origin:'viewport',x:field.x,y:field.y,duration:100},{type:'pointerDown',button:0},{type:'pause',duration:50},{type:'pointerUp',button:0}]}]}));
  console.log('Diagnostic combined-action comparison:',JSON.stringify(await execute('return {active:document.activeElement.id,events:window.__inputEvidence}')));
  const found=JSON.parse((await remote('POST','/session/'+sid+'/element',JSON.stringify({using:'css selector',value:'#value'}))).toString());
  const eid=found.value['element-6066-11e4-a52e-4f735466cecf'];
  await remote('POST','/session/'+sid+'/element/'+eid+'/click','{}');
  console.log('Diagnostic element-click comparison:',JSON.stringify(await execute('return {active:document.activeElement.id,events:window.__inputEvidence}')));
  throw Error('Coordinate pointer input failed; element-click comparison is diagnostic only');
 }
 assert.equal(await execute('return document.activeElement.id'),'value','Pointer must focus the measured field');
 await ok({op:'input',events:[{type:'text',text:'Rust 双端输入 👋'}]});
 assert.equal(await execute('return document.querySelector("#value").value'),'Rust 双端输入 👋');
 await ok({op:'input',events:[{type:'key',key:'Control',down:true},{type:'key',key:'a',down:true},{type:'key',key:'a',down:false},{type:'key',key:'Control',down:false},{type:'text',text:'replacement'}]});
 assert.equal(await execute('return document.querySelector("#value").value'),'replacement');
 const save=await execute('const r=document.querySelector("#save").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};');
 await ok({op:'input',events:[{type:'pointer',phase:'down',x:save.x,y:save.y,button:0},{type:'pointer',phase:'up',x:save.x,y:save.y,button:0}]});
 assert.equal(await execute('return document.querySelector("#result").textContent'),'Saved: replacement');
 console.log('PASS Rust -> deeptensor WPE: real pointer focus/click, Unicode text, modifier selection, replace and save.');
 const wheel=await command({op:'input',events:[{type:'wheel',x:900,y:500,delta_x:0,delta_y:450}]});
 if(!wheel.ok)throw Error('Native wheel unsupported: '+wheel.error);
 await new Promise(r=>setTimeout(r,400));assert.ok(await execute('return scrollY>0'),'Wheel must actually scroll the remote page');
 const evidence=await execute('return window.__inputEvidence');
 assert.ok(evidence.some(e=>e.name==='wheel'&&e.trusted));assert.ok(evidence.some(e=>e.name==='pointerdown'&&e.trusted));
 await ok({op:'release'});
 const screenshot=await ok({op:'screenshot'});assert.ok(Buffer.from(screenshot,'base64').length>1000);
 console.log('PASS native trusted wheel event, scrolling, input release, and screenshot. Evidence:',JSON.stringify(evidence));
 const rejected=await command({op:'input',events:[{type:'pointer',phase:'down',x:9999,y:0,button:0}]});assert.equal(rejected.ok,false);
 console.log('PASS out-of-bounds input rejection.');
 await execute('localStorage.setItem("masaka-engine-state","state-value");document.cookie="masaka_engine_cookie=cookie-value; Path=/; SameSite=Lax";return true;');
 const exported=await ok({op:'export_state'});
 assert.ok(exported.local_storage.some(item=>item.name==='masaka-engine-state'&&item.value==='state-value'));
 assert.ok(exported.cookies.some(cookie=>cookie.name==='masaka_engine_cookie'&&cookie.value==='cookie-value'));
 await ok({op:'close'});sid=undefined;
 const restored=await ok({op:'create',proxy:null,profile_dir:null});sid=restored.sessionId;
 await ok({op:'navigate',url:'https://masaka-ai.vercel.app/browser-check.html'});
 await ok({op:'import_state',cookies:exported.cookies,local_storage:exported.local_storage});
 await ok({op:'navigate',url:'https://masaka-ai.vercel.app/browser-check.html'});
 assert.deepEqual(await execute('return {storage:localStorage.getItem("masaka-engine-state"),cookie:document.cookie.includes("masaka_engine_cookie=cookie-value")}'),{storage:'state-value',cookie:true});
 console.log('PASS WPE cookie and localStorage export/import across a fresh engine session.');
}finally{
 if(sid)await command({op:'close'}).catch(()=>{});
 child.stdin.end();server.close();
 setTimeout(()=>child.kill(),2000).unref();
}
