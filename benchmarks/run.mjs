import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { MasakaBrowser } from '../sdk/client.mjs';
import { summarizeSamples } from './stats.mjs';

const providerNames = ['masaka', 'browser-use', 'kernel'];
const defaultTargetUrl = 'https://masaka-ai.vercel.app/browser-check.html';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function parseArguments(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith('--')) throw Error(`Unknown argument: ${value}`);
    const [name, ...rest] = value.slice(2).split('=');
    if (!rest.length) throw Error(`Use --${name}=value`);
    parsed[name] = rest.join('=');
  }
  return parsed;
}

export function safeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:msk_|bu_)[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/\bwss?:\/\/[^\s"'<>]+/gi, '[redacted-websocket-url]')
    .replace(/\b(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]+/gi, '$1?[redacted]')
    .replace(/([?&](?:jwt|token|ticket)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 500);
}

export function safeReportUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '[redacted-url]';
  }
}

export function verifyTarget(page, { expectTitle = null, expectSelector = null } = {}) {
  if (!page?.hasBody) throw Error('Target page did not expose a document body');
  if (!page.title) throw Error('Target page did not expose a title');
  if (expectTitle && page.title !== expectTitle) throw Error(`Unexpected target title: ${page.title}`);
  if (expectSelector && page.marker !== true) throw Error(`Target marker was not found: ${expectSelector}`);
  return page;
}

export async function stopWithRetry(operation, { attempts = 3, pause = sleep } = {}) {
  const started = performance.now();
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await operation();
      return Math.round(performance.now() - started);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await pause(150 * attempt);
    }
  }
  throw lastError;
}

function masakaEvaluationValue(result) {
  const evaluation = result?.evaluation;
  if (evaluation?.exceptionDetails) throw Error(evaluation.exceptionDetails.text || 'Browser evaluation failed');
  return evaluation?.result?.value ?? result?.value ?? result;
}

async function requestJson(url, { method = 'GET', headers = {}, body, timeout = 60_000 } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw Error(data?.error || data?.message || `${method} ${new URL(url).pathname} failed (${response.status})`);
  return data;
}

class AccountMasakaClient {
  constructor({ accessToken, projectId, baseUrl, signOut }) {
    this.accessToken = accessToken;
    this.projectId = projectId;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.signOut = signOut;
    this.controlTokens = new Map();
  }
  request(path, method = 'GET', body, control) {
    return requestJson(`${this.baseUrl}/api/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'X-Masaka-Project': this.projectId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(control ? { 'X-Masaka-Control': control } : {})
      },
      body
    });
  }
  create({ url, region, maxSeconds, name }) {
    return this.request('sessions', 'POST', { url, region, preview_mode: 'visual', max_seconds: maxSeconds, name });
  }
  get(id) { return this.request(`sessions/${encodeURIComponent(id)}`); }
  async waitForReady(id, { timeout = 90_000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const session = await this.get(id);
      if (session.status === 'running') return session;
      if (['failed', 'completed'].includes(session.status)) throw Error(session.error || `Session ended as ${session.status}`);
      await sleep(300);
    }
    throw Error('Browser startup timed out');
  }
  async action(id, action, { timeout = 45_000 } = {}) {
    let token = this.controlTokens.get(id);
    if (!token) {
      // Account access tokens represent the signed-in human controller. The
      // server-key SDK uses agent control instead; the backend intentionally
      // keeps those two capabilities distinct.
      const claim = await this.request(`sessions/${encodeURIComponent(id)}/control`, 'POST', { mode: 'human' });
      token = claim.token;
      this.controlTokens.set(id, token);
    }
    const command = await this.request(`sessions/${encodeURIComponent(id)}/commands`, 'POST', action, token);
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const current = await this.request(`commands/${encodeURIComponent(command.id)}`);
      if (current.status === 'completed') return current.result;
      if (current.status === 'failed') throw Error(current.error || 'Browser command failed');
      await sleep(120);
    }
    throw Error('Browser command timed out');
  }
  evaluate(id, expression) { return this.action(id, { kind: 'evaluate', expression }); }
  async stop(id) {
    const token = this.controlTokens.get(id);
    try {
      if (token) await this.request(`sessions/${encodeURIComponent(id)}/control`, 'DELETE', undefined, token).catch(() => {});
      return await this.request(`sessions/${encodeURIComponent(id)}/stop`, 'POST', {});
    } finally { this.controlTokens.delete(id); }
  }
  async close() { await this.signOut?.(); }
}

async function masakaClient(environment) {
  const baseUrl = environment.MASAKA_API_ORIGIN || 'https://masaka-backend.vercel.app';
  if (environment.MASAKA_API_KEY) {
    const client = new MasakaBrowser({ apiKey: environment.MASAKA_API_KEY, baseUrl });
    client.close = async () => {};
    return client;
  }

  let accessToken = environment.MASAKA_ACCESS_TOKEN;
  let projectId = environment.MASAKA_PROJECT_ID;
  if (!accessToken) return null;

  if (!projectId) {
    const projects = await requestJson(`${baseUrl}/api/projects?page=1&page_size=1`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    projectId = projects?.items?.[0]?.id;
  }
  if (!projectId) throw Error('Set MASAKA_PROJECT_ID for access-token benchmarking');
  return new AccountMasakaClient({ accessToken, projectId, baseUrl });
}

async function runMasaka({ environment, targetUrl, region, run, expectations }) {
  let client, session;
  const sample = { run, status: 'failed', stage: 'authenticate' };
  let started;
  try {
    client = await masakaClient(environment);
    if (!client) return { skipped: 'Set MASAKA_API_KEY (or MASAKA_ACCESS_TOKEN and MASAKA_PROJECT_ID)' };
    sample.stage = 'create';
    started = performance.now();
    session = await client.create({
      url: targetUrl,
      region,
      maxSeconds: 180,
      name: `Runtime benchmark ${run}`
    });
    sample.stage = 'ready';
    const ready = await client.waitForReady(session.id, { timeout: 90_000 });
    if (ready.worker_version) sample.workerVersion = ready.worker_version;
    sample.region = ready.region || region;

    sample.stage = 'page';
    const selector = JSON.stringify(expectations.expectSelector || null);
    const pageResult = await client.evaluate(session.id, `(()=>{const selector=${selector};return {title:document.title,hasBody:Boolean(document.body),marker:selector?Boolean(document.querySelector(selector)):null,url:location.href}})()`);
    const page = verifyTarget(masakaEvaluationValue(pageResult), expectations);
    sample.targetReadyMs = Math.round(performance.now() - started);
    sample.title = page?.title || null;
    sample.url = safeReportUrl(page?.url || ready.url || targetUrl);

    sample.stage = 'script';
    const scriptStarted = performance.now();
    const checkResult = await client.evaluate(session.id, `({title: document.title, hasBody: Boolean(document.body), marker: true})`);
    sample.scriptRoundTripMs = Math.round(performance.now() - scriptStarted);
    const check = masakaEvaluationValue(checkResult);
    if (!check?.hasBody || check.title !== sample.title) throw Error('DOM verification failed');
    sample.status = 'passed';
    delete sample.stage;
  } catch (error) {
    sample.error = safeError(error);
  } finally {
    if (session) {
      try { sample.stopMs = await stopWithRetry(() => client.stop(session.id)); }
      catch (error) {
        sample.cleanupError = safeError(error);
        sample.error ||= 'Session cleanup failed after three attempts';
        sample.status = 'failed';
        sample.stage = 'cleanup';
      }
    }
    await client?.close?.().catch(() => {});
  }
  return { sample };
}

const externalProviders = {
  'browser-use': {
    key: 'BROWSER_USE_API_KEY',
    async create(key) {
      const value = await requestJson('https://api.browser-use.com/api/v4/browsers', {
        method: 'POST',
        headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
        body: { proxyCountryCode: null, timeout: 5, browserScreenWidth: 1280, browserScreenHeight: 800 }
      });
      return { id: value.id, cdpUrl: value.cdpUrl, region: null };
    },
    stop(key, id) {
      return requestJson(`https://api.browser-use.com/api/v4/browsers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
        body: { action: 'stop' }
      });
    }
  },
  kernel: {
    key: 'KERNEL_API_KEY',
    async create(key) {
      const value = await requestJson('https://api.onkernel.com/browsers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: { headless: false, stealth: false, timeout_seconds: 300, viewport: { width: 1280, height: 800 } }
      });
      return { id: value.session_id, cdpUrl: value.cdp_ws_url, region: value.region || null };
    },
    stop(key, id) {
      return requestJson(`https://api.onkernel.com/browsers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${key}` }
      });
    }
  }
};

async function runExternal({ provider, environment, targetUrl, run, expectations }) {
  const adapter = externalProviders[provider];
  const key = environment[adapter.key];
  if (!key) return { skipped: `Set ${adapter.key}` };
  let managed, browser;
  const sample = { run, status: 'failed', stage: 'create' };
  const started = performance.now();
  try {
    managed = await adapter.create(key);
    if (!managed.cdpUrl) throw Error('Provider did not return a CDP URL');
    sample.stage = 'connect';
    browser = await chromium.connectOverCDP(managed.cdpUrl, { timeout: 60_000 });
    sample.region = managed.region;

    const context = browser.contexts()[0];
    if (!context) throw Error('Provider did not return a browser context');
    const page = context.pages()[0] || await context.newPage();
    sample.stage = 'page';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const inspected = verifyTarget(await page.evaluate(selector => ({
      title: document.title,
      hasBody: Boolean(document.body),
      marker: selector ? Boolean(document.querySelector(selector)) : null,
      url: location.href
    }), expectations.expectSelector || null), expectations);
    sample.title = inspected.title;
    sample.url = safeReportUrl(inspected.url || page.url());
    sample.targetReadyMs = Math.round(performance.now() - started);

    sample.stage = 'script';
    const scriptStarted = performance.now();
    const check = await page.evaluate(() => ({ title: document.title, hasBody: Boolean(document.body) }));
    sample.scriptRoundTripMs = Math.round(performance.now() - scriptStarted);
    if (!check.hasBody || check.title !== sample.title) throw Error('DOM verification failed');
    sample.status = 'passed';
    delete sample.stage;
  } catch (error) {
    sample.error = safeError(error);
  } finally {
    await browser?.close().catch(() => {});
    if (managed) {
      try { sample.stopMs = await stopWithRetry(() => adapter.stop(key, managed.id)); }
      catch (error) {
        sample.cleanupError = safeError(error);
        sample.error ||= 'Session cleanup failed after three attempts';
        sample.status = 'failed';
        sample.stage = 'cleanup';
      }
    }
  }
  return { sample };
}

export async function runBenchmark({ providers, runs, targetUrl, region = 'overseas', expectTitle, expectSelector, environment = process.env }) {
  const normalizedTarget = new URL(targetUrl).href;
  const isDefaultTarget = normalizedTarget === new URL(defaultTargetUrl).href;
  const expectations = {
    expectTitle: expectTitle === undefined && isDefaultTarget ? 'MASAKA browser verification' : expectTitle || null,
    expectSelector: expectSelector === undefined && isDefaultTarget ? '#save' : expectSelector || null
  };
  if (!expectations.expectTitle && !expectations.expectSelector) throw Error('Provide expectTitle or expectSelector for a custom benchmark target');
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    method: {
      targetUrl: safeReportUrl(normalizedTarget),
      expectations,
      viewport: { width: 1280, height: 800 },
      runs,
      concurrency: 1,
      order: providers,
      metrics: ['targetReadyMs', 'scriptRoundTripMs', 'stopMs']
    },
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    providers: {}
  };

  for (const provider of providers) {
    const samples = [];
    for (let run = 1; run <= runs; run += 1) {
      let result;
      try {
        result = provider === 'masaka'
          ? await runMasaka({ environment, targetUrl: normalizedTarget, region, run, expectations })
          : await runExternal({ provider, environment, targetUrl: normalizedTarget, run, expectations });
      } catch (error) {
        result = { sample: { run, status: 'failed', stage: 'initialize', error: safeError(error) } };
      }
      if (result.skipped) {
        report.providers[provider] = { status: 'skipped', reason: result.skipped };
        break;
      }
      samples.push(result.sample);
    }
    if (!report.providers[provider]) {
      report.providers[provider] = { status: samples.some(sample => sample.status === 'passed') ? 'measured' : 'failed', summary: summarizeSamples(samples), samples };
    }
  }
  return report;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const providers = (args.providers || providerNames.join(',')).split(',').map(value => value.trim()).filter(Boolean);
  const unknown = providers.filter(value => !providerNames.includes(value));
  if (unknown.length) throw Error(`Unknown provider: ${unknown.join(', ')}`);
  const runs = Number(args.runs || 5);
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw Error('--runs must be an integer from 1 to 100');
  const targetUrl = new URL(args.url || defaultTargetUrl);
  if (!['http:', 'https:'].includes(targetUrl.protocol)) throw Error('--url must use http or https');
  const customTarget = Boolean(args.url);
  if (customTarget && !args['expect-title'] && !args['expect-selector']) throw Error('Custom --url requires --expect-title or --expect-selector');
  const report = await runBenchmark({
    providers,
    runs,
    targetUrl: targetUrl.href,
    region: args.region || process.env.MASAKA_BROWSER_REGION || 'overseas',
    expectTitle: args['expect-title'],
    expectSelector: args['expect-selector']
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, output, { mode: 0o600 });
  }
  process.stdout.write(output);
  const results = Object.values(report.providers);
  if (!results.some(value => value.status === 'measured')) process.exitCode = 2;
  else if (results.some(value => value.status === 'failed' || value.summary?.failed > 0)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
