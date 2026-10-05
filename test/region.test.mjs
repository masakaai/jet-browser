import test from 'node:test';
import assert from 'node:assert/strict';
import {browserRegion,browserRegions} from '../src/region.mjs';

test('browser regions have a stable overseas default and China option',()=>{
 assert.deepEqual(browserRegions,['china','overseas']);
 assert.equal(browserRegion(),'overseas');
 assert.equal(browserRegion(' CHINA '),'china');
 assert.throws(()=>browserRegion('eu-west'),/Unsupported browser region/);
});
