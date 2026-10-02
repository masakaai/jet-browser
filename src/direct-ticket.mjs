import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyDirectTicket(token, secret = process.env.DATA_PLANE_TICKET_SECRET || process.env.VAULT_ENCRYPTION_KEY) {
  if (!secret || secret.length < 32 || typeof token !== 'string') throw new Error('Invalid data-plane ticket');
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) throw new Error('Invalid data-plane ticket');
  const expected = createHmac('sha256', secret).update(body).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.toString('base64url') !== signature || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid data-plane ticket');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (claims.v !== 1 || !Number.isSafeInteger(claims.exp) || claims.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired data-plane ticket');
  return claims;
}
