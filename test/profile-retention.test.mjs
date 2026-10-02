import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROFILE_STATE_TTL_MS,nextProfileExpiry,profileStateExpired} from '../src/profile-retention.mjs';

const workerSource=readFileSync(new URL('../src/wpe-worker.mjs',import.meta.url),'utf8');

test('saved browser login state expires after twenty four hours',()=>{
 const now=Date.parse('2026-10-02T00:00:00.000Z');
 assert.equal(PROFILE_STATE_TTL_MS,24*60*60*1000);
 assert.equal(nextProfileExpiry(now),'2026-10-03T00:00:00.000Z');
 assert.equal(profileStateExpired('2026-10-02T23:59:59.999Z',now),false);
 assert.equal(profileStateExpired('2026-10-02T00:00:00.000Z',now),true);
 assert.equal(profileStateExpired(null,now),false);
});

test('worker refuses expired state and refreshes the expiry when saving',()=>{
 assert.match(workerSource,/select\('encrypted_state,state_expires_at'\)/);
 assert.match(workerSource,/profileStateExpired\(profile\.state_expires_at\)/);
 assert.match(workerSource,/removeProfileObject\(profileObject\(row\)\)/);
 assert.match(workerSource,/state_expires_at:nextProfileExpiry\(now\)/);
});
