import test from 'node:test';
import assert from 'node:assert/strict';
import {isFatalEngineFailure} from '../src/engine-failure.mjs';

test('fatal engine failures are separated from ordinary page errors',()=>{
 assert.equal(isFatalEngineFailure(Object.assign(Error('command timed out'),{driverRestartRequired:true})),true);
 assert.equal(isFatalEngineFailure(Object.assign(Error('transport failed'),{driverReusable:false})),true);
 assert.equal(isFatalEngineFailure(Error('WPE bridge exited before response')),true);
 assert.equal(isFatalEngineFailure(Error('WPE engine exited (1)')),true);
 assert.equal(isFatalEngineFailure(Error('WPE engine is closed')),true);
 assert.equal(isFatalEngineFailure(Error('Driver error: invalid session id')),true);
 assert.equal(isFatalEngineFailure(Error('no such session')),true);
 assert.equal(isFatalEngineFailure(Error('Destination blocked')),false);
 assert.equal(isFatalEngineFailure(Error('Element is not clickable')),false);
});
