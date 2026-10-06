import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MasakaAPIError,
  MasakaPage,
  MasakaTimeoutError,
  MasakaTransport,
  MasakaUserAbortError
} from '../sdk/transport.mjs';

test('SDK transport retries safe reads with bounded Retry-After handling', async () => {
  const sleeps = [];
  let attempts = 0;
  const transport = new MasakaTransport({
    baseUrl: 'https://api.example/api',
    getHeaders: async () => ({ Authorization: 'Bearer test' }),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return Response.json({ error: 'slow down' }, { status: 429, headers: { 'retry-after-ms': '25' } });
      return Response.json({ ok: true });
    },
    sleepImpl: async value => sleeps.push(value),
    random: () => 1
  });

  assert.deepEqual(await transport.request('sessions'), { ok: true });
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [25]);
});

test('SDK transport never retries an unsafe mutation implicitly', async () => {
  let attempts = 0;
  const transport = new MasakaTransport({
    baseUrl: 'https://api.example/api',
    getHeaders: async () => ({}),
    fetchImpl: async () => {
      attempts += 1;
      return Response.json({ error: 'temporarily unavailable', code: 'UPSTREAM_BUSY' }, { status: 503 });
    },
    sleepImpl: async () => { throw Error('must not sleep'); }
  });

  await assert.rejects(
    transport.request('sessions', { method: 'POST', body: { url: 'https://example.com' } }),
    error => error instanceof MasakaAPIError && error.status === 503 && error.code === 'UPSTREAM_BUSY' && error.retryable
  );
  assert.equal(attempts, 1);
});

test('SDK transport honors standard Retry-After and falls back to jittered backoff when headers are absent', async () => {
  for (const [headers, expected] of [[{ 'retry-after': '30' }, 30_000], [{}, 500]]) {
    const sleeps = [];
    let attempts = 0;
    const transport = new MasakaTransport({
      baseUrl: 'https://api.example/api',
      fetchImpl: async () => ++attempts === 1
        ? Response.json({ error: 'retry' }, { status: 503, headers })
        : Response.json({ ok: true }),
      sleepImpl: async value => sleeps.push(value),
      random: () => 1
    });
    assert.deepEqual(await transport.request('sessions'), { ok: true });
    assert.deepEqual(sleeps, [expected]);
  }
});

test('SDK transport caller abort interrupts a retry wait', async () => {
  const controller = new AbortController();
  let releaseSleep;
  const transport = new MasakaTransport({
    baseUrl: 'https://api.example/api',
    fetchImpl: async () => Response.json({ error: 'retry later' }, { status: 503 }),
    sleepImpl: async () => new Promise(resolve => { releaseSleep = resolve; }),
    random: () => 1
  });
  const pending = transport.request('sessions', { signal: controller.signal });
  while (!releaseSleep) await new Promise(resolve => setImmediate(resolve));
  controller.abort(Error('stop now'));
  await assert.rejects(pending, error => error instanceof MasakaUserAbortError && error.cause?.message === 'stop now');
  releaseSleep();
});

test('SDK transport classifies its own timeout without masking a caller abort', async () => {
  const transport = new MasakaTransport({
    baseUrl: 'https://api.example/api',
    getHeaders: async () => ({}),
    timeout: 5,
    maxRetries: 0,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    })
  });
  await assert.rejects(transport.request('sessions'), error => error instanceof MasakaTimeoutError);
});

test('SDK transport timeout and caller cancellation also bound asynchronous header acquisition', async () => {
  let observedTimeoutSignal;
  const timed = new MasakaTransport({
    baseUrl: 'https://api.example/api',
    timeout: 5,
    maxRetries: 0,
    getHeaders: ({ signal }) => new Promise((_resolve, reject) => {
      observedTimeoutSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    fetchImpl: async () => { throw Error('fetch must not run'); }
  });
  await assert.rejects(timed.request('sessions'), error => error instanceof MasakaTimeoutError);
  assert.equal(observedTimeoutSignal.aborted, true);

  const controller = new AbortController();
  let observedCallerSignal;
  const cancelled = new MasakaTransport({
    baseUrl: 'https://api.example/api',
    maxRetries: 0,
    getHeaders: ({ signal }) => new Promise((_resolve, reject) => {
      observedCallerSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    fetchImpl: async () => { throw Error('fetch must not run'); }
  });
  const pending = cancelled.request('sessions', { signal: controller.signal });
  while (!observedCallerSignal) await new Promise(resolve => setImmediate(resolve));
  controller.abort(Error('cancel headers'));
  await assert.rejects(pending, error => error instanceof MasakaUserAbortError && error.cause?.message === 'cancel headers');
  assert.equal(observedCallerSignal.aborted, true);
});

test('SDK pages iterate every page and reject non-advancing pagination', async () => {
  const loaded = [];
  const first = new MasakaPage({
    items: [{ id: 'one' }],
    pagination: { page: 1, page_size: 1, total: 2, total_pages: 2, has_previous: false, has_next: true }
  }, async page => {
    loaded.push(page);
    return new MasakaPage({
      items: [{ id: 'two' }],
      pagination: { page: 2, page_size: 1, total: 2, total_pages: 2, has_previous: true, has_next: false }
    });
  });
  const ids = [];
  for await (const item of first) ids.push(item.id);
  assert.deepEqual(ids, ['one', 'two']);
  assert.deepEqual(loaded, [2]);

  const broken = new MasakaPage({
    items: [{ id: 'one' }],
    pagination: { page: 1, page_size: 1, total: 2, total_pages: 2, has_previous: false, has_next: true }
  }, async () => new MasakaPage({
    items: [{ id: 'again' }],
    pagination: { page: 1, page_size: 1, total: 2, total_pages: 2, has_previous: false, has_next: true }
  }));
  await assert.rejects(async () => {
    for await (const _item of broken) void _item;
  }, /did not advance/);

  assert.throws(() => new MasakaPage({
    items: [],
    pagination: { page: 1, page_size: 1, total: 0, total_pages: 1, has_previous: false, has_next: true }
  }), /Inconsistent pagination direction/);
  assert.throws(() => new MasakaPage({
    items: [],
    pagination: { page: 1, page_size: 1, total: 0, total_pages: 5, has_previous: false, has_next: true }
  }), /Inconsistent pagination totals/);
});
