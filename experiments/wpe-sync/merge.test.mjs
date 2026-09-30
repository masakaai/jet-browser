import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeState} from './merge.mjs';
test('bidirectional independent edits and explicit deletion',()=>{
 assert.deepEqual(mergeState({a:1,b:2,logout:3},{a:4,b:2},{a:1,b:5,logout:3}),{merged:{a:4,b:5},conflicts:[]});
});
test('conflicting token rotations are not silently overwritten',()=>{
 assert.deepEqual(mergeState({token:'old'},{token:'local'},{token:'remote'}),{merged:{},conflicts:['token']});
});
test('re-applying reconciled state is idempotent',()=>{
 const {merged}=mergeState({a:1},{a:2},{a:1});
 assert.deepEqual(mergeState(merged,merged,merged),{merged,conflicts:[]});
});
