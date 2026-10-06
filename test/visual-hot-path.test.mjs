import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../src/wpe-worker.mjs',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/wpe-client.mjs',import.meta.url),'utf8');

test('Visual capture never waits for a page script probe',()=>{
 assert.doesNotMatch(worker,/engineTask\(\(\)=>engine\.visualState\(\)\)/);
 assert.match(worker,/const visual=\{title:control\.row\.title,url:control\.row\.url\}/);
 assert.match(client,/documentStateDuringNavigation=false/);
});
