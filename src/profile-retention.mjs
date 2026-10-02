export const PROFILE_STATE_TTL_MS=24*60*60*1000;

export function nextProfileExpiry(now=Date.now()){
 const value=Number(now);if(!Number.isFinite(value))throw Error('Invalid profile retention clock');
 return new Date(value+PROFILE_STATE_TTL_MS).toISOString();
}

export function profileStateExpired(expiresAt,now=Date.now()){
 if(!expiresAt)return false;
 const expiry=Date.parse(expiresAt),clock=Number(now);
 return !Number.isFinite(expiry)||!Number.isFinite(clock)||expiry<=clock;
}
