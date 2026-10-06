import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../src/wpe-worker.mjs',import.meta.url),'utf8');
const autoscaler=readFileSync(new URL('../scripts/autoscale-wpe.mjs',import.meta.url),'utf8');

test('workers register and claim only their configured browser region',()=>{
 assert.match(worker,/MASAKA_BROWSER_REGION/);
 assert.match(worker,/claim_regional_session/);
 assert.match(worker,/p_region:region/);
 assert.match(worker,/region,heartbeat_at/);
});

test('autoscaler isolates demand, workers, containers and status by region',()=>{
 assert.match(autoscaler,/browser_sessions[^`]+region=eq\.\$\{encodeURIComponent\(region\)\}/);
 assert.match(autoscaler,/workers[^`]+region=eq\.\$\{encodeURIComponent\(region\)\}/);
 assert.match(autoscaler,/MASAKA_BROWSER_REGION=\$\{region\}/);
 assert.match(autoscaler,/browser_region_capacity/);
 assert.match(autoscaler,/for \(let index = 1;/);
 assert.doesNotMatch(autoscaler,/let runningRequired = 1/);
});
