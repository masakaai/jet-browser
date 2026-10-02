import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export function isPublicIP(address) {
  try { let parsed=ipaddr.parse(address); if(parsed.kind()==='ipv6'&&parsed.isIPv4MappedAddress())parsed=parsed.toIPv4Address(); return parsed.range()==='unicast'; } catch{return false;}
}
export async function resolvePublic(hostname) {
  const host=hostname.replace(/^\[|\]$/g,'');
  const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length||addresses.some(a=>!isPublicIP(a.address)))throw Error('Private network destinations are blocked');
  return addresses[0];
}
export function webURL(value) {
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port)))throw Error('Only public HTTP(S) destinations are allowed');
  return u;
}
async function upstreamProxy(value,resolve=resolvePublic){
 if(!value)return null;const url=new URL(value);
  if(url.protocol!=='http:'||!url.hostname||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid upstream proxy');
 const destination=await resolve(url.hostname),authorization=url.username||url.password?'Basic '+Buffer.from(decodeURIComponent(url.username)+':'+decodeURIComponent(url.password)).toString('base64'):null;
  return {host:destination.address,family:destination.family,port:Number(url.port||80),authorization};
}
const authority=(address,port)=>`${net.isIP(address)===6?'['+address+']':address}:${port}`;
export function pinnedProxyTarget(value,address){const url=value instanceof URL?value:new URL(value),port=Number(url.port||(url.protocol==='https:'?443:80)),target=authority(address,port);return {authority:target,absolute:`${url.protocol}//${target}${url.pathname}${url.search}`};}
export function openChainedTunnel(chained, target, originalAuthority) {
  return new Promise((resolve,reject)=>{
    const socket=net.connect({host:chained.host,family:chained.family,port:chained.port});
    let response=Buffer.alloc(0),settled=false;
    const fail=error=>{if(settled)return;settled=true;socket.destroy();reject(error instanceof Error?error:Error('Upstream proxy tunnel failed'));};
    socket.setTimeout(20000,()=>fail(Error('Upstream proxy tunnel timed out')));
    socket.once('error',fail);
    const closed=()=>fail(Error('Upstream proxy closed during tunnel negotiation'));
    socket.once('end',closed);socket.once('close',closed);
    socket.once('connect',()=>{
      const auth=chained.authorization?`Proxy-Authorization: ${chained.authorization}\r\n`:'';
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${originalAuthority}\r\n${auth}Connection: keep-alive\r\n\r\n`);
    });
    const negotiate=chunk=>{
      response=Buffer.concat([response,chunk]);
      if(response.length>16384)return fail(Error('Upstream proxy response is too large'));
      const end=response.indexOf('\r\n\r\n');if(end<0)return;
      socket.off('data',negotiate);
      if(!/^HTTP\/1\.[01] 200\b/.test(response.subarray(0,end).toString('latin1')))return fail(Error('Upstream proxy refused tunnel'));
      settled=true;socket.setTimeout(0);socket.off('error',fail);socket.off('end',closed);socket.off('close',closed);
      const rest=response.subarray(end+4);if(rest.length)socket.unshift(rest);
      resolve(socket);
    };
    socket.on('data',negotiate);
  });
}
export async function startProxy(upstreamURL=null,{resolve=resolvePublic}={}) {
  const chained=await upstreamProxy(upstreamURL,resolve);
  const sockets=new Set();
  const server=http.createServer(async(req,res)=>{
    try {
      const u=webURL(req.url),destination=await resolve(u.hostname);
      if(u.protocol!=='http:')throw Error('Use CONNECT for TLS');
      const headers={...req.headers,host:u.host}; delete headers['proxy-authorization'];delete headers['proxy-connection'];
      const targetPort=Number(u.port||80),pinned=pinnedProxyTarget(u,destination.address).authority;
      const tunnel=chained?await openChainedTunnel(chained,pinned,u.host):null;
      const agent=tunnel?new http.Agent({keepAlive:false}):undefined;
      if(agent)agent.createConnection=(_options,callback)=>{callback?.(null,tunnel);return tunnel;};
      const upstream=http.request({host:destination.address,family:destination.family,port:targetPort,path:u.pathname+u.search,method:req.method,headers,timeout:20000,...(agent?{agent}:{})},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
      upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
    }catch{res.writeHead(403);res.end('Destination blocked');}
  });
  server.on('connect',async(req,socket,head)=>{
    try {
      const u=new URL('http://'+req.url);if(!['443','80'].includes(u.port||'80'))throw Error('Port blocked');
      const destination=await resolve(u.hostname);
      if(chained){
        const upstream=await openChainedTunnel(chained,pinnedProxyTarget(u,destination.address).authority,req.url);
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
        upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());return;
      }
      const upstream=net.connect({host:destination.address,family:destination.family,port:Number(u.port||80)});
      upstream.setTimeout(60000,()=>upstream.destroy());
      upstream.on('connect',()=>{
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
      });
      upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
    }catch{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
  });
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}`,close(){for(const s of sockets)s.destroy();server.close();}};
}
