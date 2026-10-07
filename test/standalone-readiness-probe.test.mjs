import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForFixtureDocument } from '../scripts/standalone-readiness.mjs';

test('standalone readiness retries a transient missing window before the target commits', async () => {
  const target = 'http://127.0.0.1:8080/';
  const outcomes = [
    new Error('document_state: Driver error: no such window'),
    { url: 'about:blank', readyState: 'complete' },
    { url: target, readyState: 'interactive' },
  ];
  const pauses = [];
  const state = await waitForFixtureDocument(async () => {
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }, target, { attempts: 3, intervalMs: 125, pause: async value => pauses.push(value) });
  assert.equal(state.url, target);
  assert.deepEqual(pauses, [125, 125]);
});

test('standalone readiness remains bounded and reports the last probe failure', async () => {
  let calls = 0;
  await assert.rejects(waitForFixtureDocument(async () => {
    calls++;
    throw new Error('no such window');
  }, 'http://127.0.0.1:8080/', { attempts: 4, intervalMs: 0, pause: async () => {} }), /no such window/);
  assert.equal(calls, 4);
});
