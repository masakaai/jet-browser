const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const sleep = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = setTimeout(done, milliseconds);
  function done() { signal?.removeEventListener('abort', aborted); resolve(); }
  function aborted() { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason); }
  signal?.addEventListener('abort', aborted, { once: true });
});

export class MasakaError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class MasakaAPIError extends MasakaError {
  constructor({ status, body, headers }) {
    const value = body && typeof body === 'object' ? body : {};
    const message = typeof value.error === 'string' ? value.error
      : typeof value.message === 'string' ? value.message
        : `Browser API request failed (${status})`;
    super(message);
    this.status = status;
    this.code = typeof value.code === 'string' ? value.code : null;
    this.body = body ?? null;
    this.headers = headers;
    this.requestId = headers.get('x-request-id') || headers.get('x-vercel-id') || null;
    this.retryable = retryableStatus(status);
  }
}

export class MasakaConnectionError extends MasakaError {
  constructor(message = 'Unable to connect to the Browser API.', options) {
    super(message, options);
    this.retryable = true;
  }
}

export class MasakaTimeoutError extends MasakaConnectionError {
  constructor(message = 'Browser API request timed out.', options) {
    super(message, options);
  }
}

export class MasakaUserAbortError extends MasakaError {
  constructor(message = 'Browser API request was aborted.', options) {
    super(message, options);
  }
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MasakaError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function normalizedBaseUrl(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new MasakaError('baseUrl must be an HTTP(S) URL without credentials');
  }
  url.hash = '';
  url.search = '';
  return url.href.replace(/\/$/, '');
}

function requestUrl(baseUrl, path) {
  const value = String(path || '').replace(/^\/+/, '');
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    throw new MasakaError('Request path must be relative');
  }
  const url = new URL(`${baseUrl}/${value}`);
  if (!url.href.startsWith(`${baseUrl}/`)) throw new MasakaError('Request path escaped the API base URL');
  return url.href;
}

async function readResponseBody(response) {
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
  }
  if (typeof response.json === 'function') return response.json().catch(() => null);
  return null;
}

function retryDelay(headers, attempt, random) {
  const retryAfterMillisecondsHeader = headers.get('retry-after-ms');
  const retryAfterMilliseconds = Number(retryAfterMillisecondsHeader);
  if (retryAfterMillisecondsHeader !== null && Number.isFinite(retryAfterMilliseconds) && retryAfterMilliseconds >= 0) {
    return Math.min(60_000, Math.round(retryAfterMilliseconds));
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const value = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(value) && value >= 0) return Math.min(60_000, Math.round(value));
  }
  const base = Math.min(8_000, 500 * (2 ** attempt));
  return Math.round(base * (0.75 + Math.max(0, Math.min(1, random())) * 0.25));
}

async function waitForRetry(sleepImpl, milliseconds, signal) {
  if (!signal) return sleepImpl(milliseconds, null);
  if (signal.aborted) throw new MasakaUserAbortError(undefined, { cause: signal.reason });
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(new MasakaUserAbortError(undefined, { cause: signal.reason }));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([Promise.resolve().then(() => sleepImpl(milliseconds, signal)), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function waitForSignal(operation, signal) {
  if (signal.aborted) throw signal.reason;
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function normalizedSignal(value) {
  if (!value) return null;
  if (typeof value.aborted !== 'boolean' || typeof value.addEventListener !== 'function') {
    throw new MasakaError('signal must be an AbortSignal');
  }
  return value;
}

/** Shared HTTP transport for the trusted and signed-in SDKs. */
export class MasakaTransport {
  constructor({
    baseUrl,
    getHeaders = async () => ({}),
    fetchImpl = globalThis.fetch,
    timeout = 60_000,
    maxRetries = 2,
    sleepImpl = sleep,
    random = Math.random
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new MasakaError('fetch is unavailable');
    if (typeof getHeaders !== 'function') throw new MasakaError('getHeaders must be a function');
    if (typeof sleepImpl !== 'function') throw new MasakaError('sleepImpl must be a function');
    if (typeof random !== 'function') throw new MasakaError('random must be a function');
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.getHeaders = getHeaders;
    this.fetch = fetchImpl;
    this.timeout = integer(timeout, 'timeout', 1, 300_000);
    this.maxRetries = integer(maxRetries, 'maxRetries', 0, 10);
    this.sleep = sleepImpl;
    this.random = random;
  }

  async request(path, {
    method = 'GET',
    body,
    headers = {},
    raw = false,
    timeout = this.timeout,
    maxRetries = this.maxRetries,
    retry = 'safe',
    signal
  } = {}) {
    const verb = String(method).toUpperCase();
    const requestTimeout = integer(timeout, 'timeout', 1, 300_000);
    const retries = integer(maxRetries, 'maxRetries', 0, 10);
    if (!['safe', 'always', 'never'].includes(retry)) throw new MasakaError('retry must be safe, always, or never');
    const retryAllowed = retry === 'always' || (retry === 'safe' && SAFE_METHODS.has(verb));
    const callerSignal = normalizedSignal(signal);
    const url = requestUrl(this.baseUrl, path);

    for (let attempt = 0; ; attempt += 1) {
      if (callerSignal?.aborted) throw new MasakaUserAbortError(undefined, { cause: callerSignal.reason });
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort(callerSignal.reason);
      callerSignal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new MasakaTimeoutError());
      }, requestTimeout);
      timer.unref?.();

      try {
        const baseHeaders = await waitForSignal(() => this.getHeaders({ signal: controller.signal }), controller.signal);
        const requestHeaders = { Accept: 'application/json', ...baseHeaders, ...headers };
        if (body !== undefined && !Object.keys(requestHeaders).some(name => name.toLowerCase() === 'content-type')) {
          requestHeaders['Content-Type'] = 'application/json';
        }
        const response = await this.fetch(url, {
          method: verb,
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
        const responseHeaders = new Headers(response.headers || {});
        if (!response.ok) {
          if (retryAllowed && attempt < retries && retryableStatus(Number(response.status))) {
            await response.body?.cancel?.().catch?.(() => {});
            await waitForRetry(this.sleep, retryDelay(responseHeaders, attempt, this.random), callerSignal);
            continue;
          }
          throw new MasakaAPIError({ status: Number(response.status), body: await readResponseBody(response), headers: responseHeaders });
        }
        if (raw) return response;
        if (Number(response.status) === 204) return null;
        return await readResponseBody(response);
      } catch (error) {
        if (error instanceof MasakaAPIError) throw error;
        if (callerSignal?.aborted) throw new MasakaUserAbortError(undefined, { cause: callerSignal.reason || error });
        const connectionError = timedOut || error instanceof MasakaTimeoutError
          ? new MasakaTimeoutError(undefined, { cause: error })
          : error instanceof MasakaConnectionError ? error
            : new MasakaConnectionError(undefined, { cause: error });
        if (retryAllowed && attempt < retries) {
          await waitForRetry(this.sleep, retryDelay(new Headers(), attempt, this.random), callerSignal);
          continue;
        }
        throw connectionError;
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', onAbort);
      }
    }
  }
}

function validPage(value) {
  if (!value || !Array.isArray(value.items) || !value.pagination || typeof value.pagination !== 'object') {
    throw new MasakaError('Invalid paginated response');
  }
  const pagination = value.pagination;
  for (const field of ['page', 'page_size', 'total', 'total_pages']) {
    if (!Number.isInteger(pagination[field]) || pagination[field] < 0) throw new MasakaError(`Invalid pagination ${field}`);
  }
  if (pagination.page < 1 || pagination.page_size < 1 || pagination.total_pages < 1) throw new MasakaError('Invalid pagination bounds');
  if (typeof pagination.has_previous !== 'boolean' || typeof pagination.has_next !== 'boolean') throw new MasakaError('Invalid pagination direction flags');
  const expectedPages = Math.max(1, Math.ceil(pagination.total / pagination.page_size));
  if (pagination.total_pages !== expectedPages) throw new MasakaError('Inconsistent pagination totals');
  if (pagination.has_previous !== (pagination.page > 1) || pagination.has_next !== (pagination.page < pagination.total_pages)) {
    throw new MasakaError('Inconsistent pagination direction');
  }
  if (value.items.length > pagination.page_size || (pagination.total === 0 && value.items.length !== 0)) throw new MasakaError('Invalid pagination items');
  return value;
}

/** One server-validated page with safe async iteration across subsequent pages. */
export class MasakaPage {
  constructor(value, loadPage = null) {
    const parsed = validPage(value);
    this.items = Object.freeze([...parsed.items]);
    this.pagination = Object.freeze({ ...parsed.pagination });
    this.filters = parsed.filters ? Object.freeze({ ...parsed.filters }) : null;
    this.loadPage = loadPage;
    this.maximumPage = Math.max(parsed.pagination.page, parsed.pagination.total_pages);
  }

  hasNextPage() {
    return this.pagination.has_next === true;
  }

  async getNextPage() {
    if (!this.hasNextPage()) throw new MasakaError('No next page is available');
    if (typeof this.loadPage !== 'function') throw new MasakaError('No page loader is configured');
    const expectedPage = this.pagination.page + 1;
    if (expectedPage > this.maximumPage) throw new MasakaError('Pagination exceeded its initial bound');
    const next = await this.loadPage(expectedPage);
    if (!(next instanceof MasakaPage)) throw new MasakaError('Page loader returned an invalid page');
    if (next.pagination.page !== expectedPage) throw new MasakaError('Pagination did not advance exactly once');
    if (next.pagination.page > this.maximumPage) throw new MasakaError('Pagination exceeded its initial bound');
    next.maximumPage = this.maximumPage;
    return next;
  }

  async *iterPages() {
    let page = this;
    while (page) {
      yield page;
      page = page.hasNextPage() ? await page.getNextPage() : null;
    }
  }

  async *[Symbol.asyncIterator]() {
    for await (const page of this.iterPages()) {
      for (const item of page.items) yield item;
    }
  }
}

export function queryString(values = {}) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) for (const item of value) query.append(name, String(item));
    else query.set(name, String(value));
  }
  return query.toString();
}
