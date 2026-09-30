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
export async function startProxy() {
  const sockets=new Set();
  const server=http.createServer(async(req,res)=>{
    try {
      const u=webURL(req.url),destination=await resolvePublic(u.hostname);
      if(u.protocol!=='http:')throw Error('Use CONNECT for TLS');
      const headers={...req.headers,host:u.host}; delete headers['proxy-authorization'];delete headers['proxy-connection'];
      const upstream=http.request({host:destination.address,family:destination.family,port:Number(u.port||80),path:u.pathname+u.search,method:req.method,headers,timeout:20000},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
      upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
    }catch{res.writeHead(403);res.end('Destination blocked');}
  });
  server.on('connect',async(req,socket,head)=>{
    try {
      const u=new URL('http://'+req.url);if(!['443','80'].includes(u.port||'80'))throw Error('Port blocked');
      const destination=await resolvePublic(u.hostname);
      const upstream=net.connect({host:destination.address,family:destination.family,port:Number(u.port||80)});
      upstream.setTimeout(60000,()=>upstream.destroy());
      upstream.on('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
      upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
    }catch{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
  });
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}`,close(){for(const s of sockets)s.destroy();server.close();}};
}
