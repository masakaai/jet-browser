import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
const key=()=>Buffer.from(process.env.VAULT_ENCRYPTION_KEY,'hex');
export function seal(value,owner){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(owner));const body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return [iv,c.getAuthTag(),body].map(x=>x.toString('base64url')).join('.');}
export function unseal(value,owner){const [iv,tag,body]=value.split('.').map(x=>Buffer.from(x,'base64url'));const c=createDecipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(owner));c.setAuthTag(tag);return JSON.parse(Buffer.concat([c.update(body),c.final()]).toString());}
