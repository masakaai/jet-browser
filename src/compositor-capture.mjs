import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';

const port=Number(process.env.MASAKA_CAPTURE_PORT||9615);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid compositor capture port');
let tail=Promise.resolve();
let lastErrorAt=0;

function runCapture(directory){
 return new Promise((resolve,reject)=>execFile('/usr/bin/weston-screenshooter',[],{
  cwd:directory,
  env:{PATH:process.env.PATH,XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,WAYLAND_DISPLAY:process.env.WAYLAND_DISPLAY},
  timeout:5000,
  maxBuffer:64_000
 },error=>error?reject(error):resolve()));
}

async function capture(){
 const directory=await mkdtemp('/tmp/masaka-compositor-frame-');
 try{
  await runCapture(directory);
  const files=(await readdir(directory)).filter(value=>value.endsWith('.png'));
  if(files.length!==1)throw Error('Compositor returned an invalid frame set');
  const frame=await readFile(directory+'/'+files[0]);
  if(frame.length<1000||frame.length>4_000_000||!frame.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Compositor returned an invalid PNG');
  return frame;
 }finally{await rm(directory,{recursive:true,force:true});}
}

const server=createServer((request,response)=>{
 if(request.method==='GET'&&request.url==='/health'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return response.end('{"ok":true}');}
 if(request.method!=='GET'||request.url!=='/capture'){response.writeHead(404);return response.end();}
 const current=tail.then(capture);
 tail=current.catch(()=>{});
 void current.then(frame=>{response.writeHead(200,{'content-type':'image/png','content-length':String(frame.length),'cache-control':'no-store'});response.end(frame);},error=>{
  const now=Date.now();
  if(now-lastErrorAt>=30000){lastErrorAt=now;console.error('Compositor capture unavailable:',String(error?.message||error).slice(0,240));}
  response.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});response.end('{"error":"capture unavailable"}');
 });
});
server.listen(port,'127.0.0.1');

const close=()=>server.close(()=>process.exit(0));
process.on('SIGTERM',close);
process.on('SIGINT',close);
