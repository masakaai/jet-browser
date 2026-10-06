import { browserRegion } from '../src/region.mjs';
import { MasakaPage, MasakaTransport, queryString } from './transport.mjs';

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || Error('Aborted'));
  const timer = setTimeout(done, milliseconds);
  function done() { signal?.removeEventListener('abort', aborted); resolve(); }
  function aborted() { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason || Error('Aborted')); }
  signal?.addEventListener('abort', aborted, { once: true });
});
const withSignal = async (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason || Error('Aborted');
  let aborted;
  const cancellation = new Promise((_resolve, reject) => {
    aborted = () => reject(signal.reason || Error('Aborted'));
    signal.addEventListener('abort', aborted, { once: true });
  });
  try { return await Promise.race([promise, cancellation]); }
  finally { signal.removeEventListener('abort', aborted); }
};
const positiveInteger = (value, label, maximum) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw Error(`${label} must be an integer from 1 to ${maximum}`);
  return value;
};

/** Trusted server SDK. API keys must never be included in a public browser bundle. */
export class JetBrowser {
  constructor({
    apiKey,
    baseUrl = 'https://masaka-backend.vercel.app',
    fetchImpl = globalThis.fetch,
    timeout = 60_000,
    maxRetries = 2,
    sleepImpl,
    random
  } = {}) {
    if (typeof apiKey !== 'string' || !apiKey) throw Error('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.controls = new Map();
    this.acquisitions = new Map();
    this.transport = new MasakaTransport({
      baseUrl: `${this.baseUrl}/api`,
      fetchImpl,
      timeout,
      maxRetries,
      ...(sleepImpl ? { sleepImpl } : {}),
      ...(random ? { random } : {}),
      getHeaders: async () => ({ Authorization: `Bearer ${this.apiKey}` })
    });
  }

  request(path, method = 'GET', body, { control, raw = false, retry, signal, timeout, maxRetries } = {}) {
    return this.transport.request(path, {
      method,
      body,
      raw,
      ...(control ? { headers: { 'X-Masaka-Control': control } } : {}),
      ...(retry ? { retry } : {}),
      ...(signal ? { signal } : {}),
      ...(timeout ? { timeout } : {}),
      ...(maxRetries !== undefined ? { maxRetries } : {})
    });
  }

  create({ url = 'https://duckduckgo.com/', profileId = null, region = 'overseas', maxSeconds = 300, name = 'Agent session' } = {}) {
    return this.request('sessions', 'POST', { url, profile_id: profileId, region: browserRegion(region), max_seconds: maxSeconds, name });
  }

  get(id, options) {
    return this.request(`sessions/${encodeURIComponent(id)}`, 'GET', undefined, options);
  }

  async list({ page = 1, pageSize = 25, tab = 'all', search = '' } = {}) {
    const options = {
      page: positiveInteger(page, 'page', 10_000),
      pageSize: positiveInteger(pageSize, 'pageSize', 100),
      tab,
      search
    };
    if (!['all', 'active', 'past'].includes(tab)) throw Error('tab must be all, active, or past');
    if (typeof search !== 'string' || search.length > 100) throw Error('search must be at most 100 characters');
    const load = async nextPage => {
      const query = queryString({ page: nextPage, page_size: options.pageSize, tab: options.tab, search: options.search });
      const value = await this.request(`sessions?${query}`);
      return new MasakaPage(value, load);
    };
    return load(options.page);
  }

  async *listAll(options = {}) {
    yield* await this.list(options);
  }

  async stop(id) {
    try {
      return await this.request(`sessions/${encodeURIComponent(id)}/stop`, 'POST', {}, { retry: 'always' });
    } finally {
      this.controls.delete(id);
      this.acquisitions.delete(id);
    }
  }

  acquire(id, { previousToken = this.controls.get(id) } = {}) {
    if (this.acquisitions.has(id)) return this.acquisitions.get(id);
    let pending;
    pending = this.request(`sessions/${encodeURIComponent(id)}/control`, 'POST', { mode: 'agent' }, { control: previousToken })
      .then(claim => {
        if (this.acquisitions.get(id) === pending) this.controls.set(id, claim.token);
        return claim;
      })
      .finally(() => {
        if (this.acquisitions.get(id) === pending) this.acquisitions.delete(id);
      });
    this.acquisitions.set(id, pending);
    return pending;
  }

  setControlToken(id, token) {
    this.acquisitions.delete(id);
    if (token) this.controls.set(id, token);
    else this.controls.delete(id);
    return this;
  }

  async waitForReady(id, { timeout = 60_000, signal } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (signal?.aborted) throw signal.reason || Error('Aborted');
      const session = await this.get(id, { signal });
      if (session.status === 'running') return session;
      if (['failed', 'completed'].includes(session.status)) throw Error(session.error || 'Session ended');
      await wait(1200, signal);
    }
    throw Error('Browser startup timed out');
  }

  async action(id, action, { timeout = 30_000, signal } = {}) {
    if (!this.controls.has(id)) await withSignal(this.acquire(id), signal);
    if (signal?.aborted) throw signal.reason || Error('Aborted');
    const command = await this.request(`sessions/${encodeURIComponent(id)}/commands`, 'POST', action, { control: this.controls.get(id), signal });
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (signal?.aborted) throw signal.reason || Error('Aborted');
      const current = await this.request(`commands/${encodeURIComponent(command.id)}`, 'GET', undefined, { signal });
      if (current.status === 'completed') return current.result;
      if (current.status === 'failed') throw Error(current.error || 'Browser command failed');
      await wait(650, signal);
    }
    throw Error('Command is still pending; inspect before retrying');
  }

  control(id, mode = 'agent') {
    if (mode !== 'agent') throw Error('The trusted SDK only acquires agent control');
    return this.acquire(id);
  }

  navigate(id, url, options) { return this.action(id, { kind: 'navigate', url }, options); }
  click(id, x, y, options) { return this.action(id, { kind: 'click', x, y }, options); }
  drag(id, x, y, toX, toY, options) { return this.action(id, { kind: 'drag', x, y, to_x: toX, to_y: toY }, options); }
  type(id, text, options) { return this.action(id, { kind: 'type', text }, options); }
  press(id, key, options) { return this.action(id, { kind: 'key', key }, options); }
  scroll(id, delta, options) { return this.action(id, { kind: 'scroll', delta }, options); }
  evaluate(id, expression, options) { return this.action(id, { kind: 'evaluate', expression }, options); }
  snapshot(id, options) { return this.action(id, { kind: 'snapshot' }, options); }
  tabs(id, options) { return this.action(id, { kind: 'tabs' }, options); }
  switchTab(id, handle, options) { return this.action(id, { kind: 'tab_switch', handle }, options); }
  newTab(id, options) { return this.action(id, { kind: 'tab_new' }, options); }
  closeTab(id, handle, options) { return this.action(id, { kind: 'tab_close', handle }, options); }
}

// Product-facing name; JetBrowser remains available for existing integrations.
export { JetBrowser as MasakaBrowser };
