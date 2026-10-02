import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {chmod,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limit=48*1024*1024,legacyMagic=Buffer.from('MSKPB1'),magic=Buffer.from('MSKPB2');
const key=()=>Buffer.from(process.env.VAULT_ENCRYPTION_KEY,'hex');
export function profileWorkspace(root,session){if(!uuid.test(session))throw Error('Invalid profile workspace');const value=path.join(root,'sessions',session);if(path.relative(root,value).startsWith('..'))throw Error('Invalid profile workspace');return value;}
export function profilePath(root,user,profile){if(!uuid.test(user)||!uuid.test(profile))throw Error('Invalid profile identity');const value=path.join(root,user,profile);if(path.relative(root,value).startsWith('..'))throw Error('Invalid profile path');return value;}
async function collect(stream,child){const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>limit){child.kill('SIGKILL');throw Error('Profile bundle is too large');}chunks.push(chunk);}const [code]=await new Promise(resolve=>child.once('close',(...args)=>resolve(args)));if(code!==0)throw Error('Profile archive failed');return Buffer.concat(chunks);}
export async function packProfile(root,user,profile,{revision=0}={}){
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid profile revision');
 const directory=profilePath(root,user,profile),parent=path.dirname(directory),name=path.basename(directory);
 const child=spawn('tar',['-C',parent,'--exclude=Cache','--exclude=WebKitCache','--exclude=NetworkCache','-czf','-',name],{stdio:['ignore','pipe','ignore']});const plain=await collect(child.stdout,child);
 const revisionBytes=Buffer.alloc(8);revisionBytes.writeBigUInt64BE(BigInt(revision));
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(`profile:${user}:${profile}:${revision}`));const body=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([magic,revisionBytes,iv,cipher.getAuthTag(),body]);
}
export async function unpackProfile(bundle,root,user,profile,{withMetadata=false}={}){
 if(!Buffer.isBuffer(bundle)||bundle.length<34||bundle.length>limit)throw Error('Invalid profile bundle');
 const current=bundle.subarray(0,6).equals(magic),legacy=bundle.subarray(0,6).equals(legacyMagic);if(!current&&!legacy)throw Error('Invalid profile bundle');
 const revision=current?Number(bundle.readBigUInt64BE(6)):0,offset=current?14:6;if(!Number.isSafeInteger(revision)||revision<0||bundle.length<offset+28)throw Error('Invalid profile bundle');
 const iv=bundle.subarray(offset,offset+12),tag=bundle.subarray(offset+12,offset+28),body=bundle.subarray(offset+28),decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAAD(Buffer.from(current?`profile:${user}:${profile}:${revision}`:`profile:${user}:${profile}`));decipher.setAuthTag(tag);const plain=Buffer.concat([decipher.update(body),decipher.final()]);
 const directory=profilePath(root,user,profile),parent=path.dirname(directory);await rm(directory,{recursive:true,force:true});await mkdir(parent,{recursive:true,mode:0o770});
 const child=spawn('tar',['-C',parent,'-xzf','-','--no-same-owner','--no-same-permissions'],{stdio:['pipe','ignore','ignore']});child.stdin.end(plain);const code=await new Promise(resolve=>child.once('close',resolve));if(code!==0){await rm(directory,{recursive:true,force:true});throw Error('Profile restore failed');}
 const permissions=spawn('chmod',['-R','g+rwX',directory],{stdio:'ignore'}),permissionCode=await new Promise(resolve=>permissions.once('close',resolve));if(permissionCode!==0){await rm(directory,{recursive:true,force:true});throw Error('Profile permissions failed');}return withMetadata?{directory,revision}:directory;
}
export async function emptyProfile(root,user,profile){const directory=profilePath(root,user,profile);await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true,mode:0o770});await chmod(directory,0o2770);return directory;}
export async function removeProfile(root,user,profile){await rm(profilePath(root,user,profile),{recursive:true,force:true});}
