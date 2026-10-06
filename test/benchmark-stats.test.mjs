import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize, summarizeSamples } from '../benchmarks/stats.mjs';
import { runBenchmark, safeError, safeReportUrl, stopWithRetry, verifyTarget } from '../benchmarks/run.mjs';

test('benchmark percentiles use nearest-rank values', () => {
  assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
  assert.equal(percentile([], 0.5), null);
  assert.throws(() => percentile([1], 2), /between 0 and 1/);
});

test('benchmark summaries retain failures and summarize passed samples only', () => {
  assert.deepEqual(summarize([10, 20, 30]), { count: 3, min: 10, median: 20, p95: 30, max: 30, mean: 20 });
  const value = summarizeSamples([
    { status: 'passed', targetReadyMs: 200, scriptRoundTripMs: 20, stopMs: 50 },
    { status: 'failed', stopMs: 70 }
  ]);
  assert.equal(value.requested, 2);
  assert.equal(value.passed, 1);
  assert.equal(value.failed, 1);
  assert.equal(value.successRate, 0.5);
  assert.equal(value.targetReadyMs.median, 200);
  assert.equal(value.stopMs.median, 50);
  assert.equal(value.stopMs.max, 70);
});

test('benchmark target checks reject error pages and missing fixture markers', () => {
  assert.throws(() => verifyTarget({ title: 'Access denied', hasBody: true, marker: false }, { expectTitle: 'MASAKA browser verification', expectSelector: '#save' }), /Unexpected target title/);
  assert.throws(() => verifyTarget({ title: 'MASAKA browser verification', hasBody: true, marker: false }, { expectSelector: '#save' }), /marker was not found/);
  assert.equal(verifyTarget({ title: 'MASAKA browser verification', hasBody: true, marker: true }, { expectTitle: 'MASAKA browser verification', expectSelector: '#save' }).title, 'MASAKA browser verification');
});

test('benchmark error output removes keys and full websocket URLs', () => {
  const value = safeError(Error('Bearer secret wss://provider.example/cdp?apiKey=secret msk_private bu_private https://example.com/path?ticket=secret'));
  assert.doesNotMatch(value, /secret|msk_private|bu_private/);
  assert.match(value, /redacted-websocket-url/);
});

test('benchmark report URLs omit credentials, queries, and fragments', () => {
  assert.equal(
    safeReportUrl('https://user:password@example.com/path?token=FAKE_SECRET#private'),
    'https://example.com/path'
  );
  assert.equal(safeReportUrl('not a URL'), '[redacted-url]');
});

test('benchmark cleanup retries bounded failures', async () => {
  let attempts = 0;
  const duration = await stopWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw Error('temporary failure');
  }, { pause: async () => {} });
  assert.equal(attempts, 3);
  assert.ok(duration >= 0);
  attempts = 0;
  await assert.rejects(stopWithRetry(async () => { attempts += 1; throw Error('persistent failure'); }, { pause: async () => {} }), /persistent failure/);
  assert.equal(attempts, 3);
});

test('MASAKA initialization failures remain in the report', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'expired token' }, { status: 401 });
  try {
    const report = await runBenchmark({
      providers: ['masaka'],
      runs: 1,
      targetUrl: 'https://masaka-ai.vercel.app/browser-check.html',
      environment: { MASAKA_ACCESS_TOKEN: 'expired' }
    });
    assert.equal(report.providers.masaka.status, 'failed');
    assert.equal(report.providers.masaka.samples[0].stage, 'authenticate');
    assert.match(report.providers.masaka.samples[0].error, /expired token/);
  } finally { globalThis.fetch = original; }
});

test('benchmark method target omits custom URL credentials', async () => {
  const report = await runBenchmark({
    providers: ['masaka'],
    runs: 1,
    targetUrl: 'https://user:password@example.com/check?token=FAKE_SECRET#private',
    expectTitle: 'Example',
    environment: {}
  });
  assert.equal(report.method.targetUrl, 'https://example.com/check');
  assert.doesNotMatch(JSON.stringify(report), /password|FAKE_SECRET|private/);
});
