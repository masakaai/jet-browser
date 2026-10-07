import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRuntimeReport } from './runtime-report.mjs';

const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
const defaultProviders = ['jet', 'browser-use', 'steel-browser', 'browserless'];
const resourceArgs = ['--cpus=2', '--memory=1g', '--pids-limit=512', '--shm-size=256m'];
const fixtureHtml = '<!doctype html><meta charset="utf-8"><title>Jet Benchmark</title><main id="ready">runtime-ready</main>';
const fixtureUrl = `data:text/html,${encodeURIComponent(fixtureHtml)}`;

function parseArguments(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith('--') || !value.includes('=')) throw Error(`Expected --name=value, received ${value}`);
    const [name, ...rest] = value.slice(2).split('=');
    parsed[name] = rest.join('=');
  }
  return parsed;
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/\b(?:Bearer|token=)\s*\S+/gi, '[redacted]')
    .replace(/wss?:\/\/[^\s"'<>]+/gi, '[redacted-websocket]')
    .slice(0, 600);
}

function command(command, args, { input, timeout = 120_000, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Error(`${command} timed out`));
    }, timeout);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
      };
      if (code && !allowFailure) reject(Error(`${command} exited ${code}: ${result.stderr.slice(-600)}`));
      else resolvePromise(result);
    });
    child.stdin.end(input);
  });
}

const docker = (args, options) => command(process.env.DOCKER || 'docker', args, options);

function parseMemoryMiB(value) {
  const match = String(value).trim().match(/^([0-9.]+)\s*([KMG]?i?B)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('g') ? 1024 : unit.startsWith('k') ? 1 / 1024 : 1;
  return Number((amount * multiplier).toFixed(2));
}

async function activeMemoryMiB(name) {
  const result = await docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', name], { timeout: 10_000 });
  const memory = parseMemoryMiB(result.stdout.split('/')[0]);
  if (memory === null) throw Error(`Memory sample was unavailable for ${name}`);
  return memory;
}

class LineQueue {
  constructor(stream) {
    this.lines = [];
    this.waiters = [];
    this.buffer = '';
    stream.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || '';
      for (const line of lines.filter(Boolean)) this.push(line);
    });
    stream.on('end', () => {
      if (this.buffer) this.push(this.buffer);
      this.buffer = '';
    });
  }
  push(line) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(line);
    else this.lines.push(line);
  }
  next(timeout = 90_000) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((resolvePromise, reject) => {
      const entry = { resolve: resolvePromise };
      this.waiters.push(entry);
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(entry);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(Error('Timed out waiting for container output'));
      }, timeout);
      entry.resolve = line => {
        clearTimeout(timer);
        resolvePromise(line);
      };
    });
  }
}

async function createContainer(name, image, args = [], commandArgs = []) {
  await docker(['create', '--name', name, ...resourceArgs, ...args, image, ...commandArgs]);
}

async function removeContainer(name) {
  try {
    await docker(['rm', '-f', name], { allowFailure: true, timeout: 20_000 });
  } catch {
    // Cleanup cannot replace the actual benchmark result. A later suite run uses a
    // process-specific name, so an unavailable Docker daemon cannot corrupt it.
  }
}

async function imageDigest(image) {
  const result = await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  return result.stdout.replace(/^sha256:/, '');
}

async function mappedPort(name, port) {
  const result = await docker(['port', name, `${port}/tcp`]);
  const match = result.stdout.match(/:(\d+)\s*$/m);
  if (!match) throw Error(`Docker did not map ${port}/tcp`);
  return Number(match[1]);
}

async function waitForHttp(url, timeout = 60_000) {
  const started = performance.now();
  let lastError;
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok || response.status < 500) return response;
      lastError = Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw lastError || Error(`Timed out waiting for ${new URL(url).pathname}`);
}

class CdpSocket {
  constructor(url) {
    this.url = url;
    this.pending = new Map();
    this.sequence = 0;
  }
  async open(timeout = 30_000) {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(Error(message.error.message || 'CDP command failed'));
      else pending.resolve(message.result);
    });
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(Error('CDP WebSocket timed out')), timeout);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('CDP WebSocket failed')); }, { once: true });
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.sequence;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.socket?.close(); }
}

async function verifyCdpRuntime(url, { started, sampleMemory }) {
  const cdp = new CdpSocket(url);
  await cdp.open();
  let targetId;
  try {
    const target = await cdp.send('Target.createTarget', { url: fixtureUrl });
    targetId = target.targetId;
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false},sessionId);
    let value;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: "({title:document.title,marker:document.querySelector('#ready')?.textContent||null})",
        returnByValue: true,
      }, sessionId);
      value = result.result?.value;
      if (value?.title === 'Jet Benchmark' && value.marker === 'runtime-ready') break;
      await sleep(20);
    }
    if (value?.title !== 'Jet Benchmark' || value.marker !== 'runtime-ready') throw Error('CDP fixture verification failed');
    const browserReadyMs = Number((performance.now() - started).toFixed(2));
    const check = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId);
    if (check.result?.value !== 'Jet Benchmark') throw Error('CDP script verification failed');
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    if (Buffer.from(screenshot.data || '', 'base64').length < 1000) throw Error('CDP screenshot verification failed');
    const activeMemoryMiB = await sampleMemory();
    await cdp.send('Target.closeTarget', { targetId });
    targetId = null;
    return { scriptVerified: true, browserReadyMs, activeMemoryMiB };
  } finally {
    if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    cdp.close();
  }
}

async function jetSample({ image, name }) {
  await createContainer(name, image, [
    '--cap-drop=ALL', '--cap-add=SETUID', '--cap-add=SETGID',
    '--security-opt=no-new-privileges', '--security-opt=systempaths=unconfined',
    '--security-opt=apparmor=unconfined',
    '--security-opt=seccomp=' + resolve('seccomp_profile.json'),
    '--env=JET_BROWSER_SMOKE=1', '-i',
  ]);
  const started = performance.now();
  const child = spawn(process.env.DOCKER || 'docker', ['start', '-a', '-i', name], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = new LineQueue(child.stdout);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const completion = new Promise((resolvePromise, reject) => {
    child.once('error', reject);
      child.once('close', code => code ? reject(Error(`Jet Browser exited ${code}: ${stderr}`)) : resolvePromise());
  });
  const commands = [
    { op: 'create', proxy: null, profile_dir: null, page_load_strategy: 'eager' },
    { op: 'navigate', url: 'http://127.0.0.1:8080/' },
    { op: 'title' },
    { op: 'evaluate', expression: "({title:document.title,marker:document.querySelector('#result')?.id||null})" },
    { op: 'evaluate', expression: 'document.title' },
    { op: 'screenshot' },
    { op: 'evaluate', expression: '(()=>{const until=Date.now()+5000;while(Date.now()<until){};return true})()' },
    { op: 'close' },
  ];
  child.stdin.end(commands.map(commandValue => JSON.stringify(commandValue)).join('\n') + '\n');
  const receive = async () => {
    const response = JSON.parse(await lines.next());
    if (!response.ok) throw Error(response.error || 'Jet Browser command failed');
    return response.value;
  };
  try {
    await receive();
    await receive();
    const title = await receive();
    const verified = await receive();
    const value = verified?.result?.value ?? verified?.value ?? verified;
    if (title !== 'Jet Browser Ready' || value?.title !== title || value.marker !== 'result') throw Error('Jet Browser fixture verification failed');
    const browserReadyMs = Number((performance.now() - started).toFixed(2));
    const check = await receive();
    const checkValue = check?.result?.value ?? check?.value ?? check;
    if (checkValue !== title) throw Error('Jet Browser script verification failed');
    const screenshot = await receive();
    if (Buffer.from(screenshot || '', 'base64').length < 1000) throw Error('Jet Browser screenshot verification failed');
    const memory = await activeMemoryMiB(name);
    const held=await receive();
    const heldValue=held?.result?.value ?? held?.value ?? held;
    if(heldValue!==true)throw Error('Jet Browser memory sampling hold failed');
    await receive();
    await completion;
    return { status: 'passed', browserReadyMs, scriptVerified: true, activeMemoryMiB: memory };
  } finally {
    child.kill('SIGKILL');
    await removeContainer(name);
  }
}

const browserUseProgram = String.raw`
import asyncio, json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from browser_use.browser.session import BrowserSession

PAGE = b'<!doctype html><meta charset="utf-8"><title>Jet Benchmark</title><main id="ready">runtime-ready</main>'
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(PAGE))); self.end_headers(); self.wfile.write(PAGE)
    def log_message(self, *args): pass

async def main():
    server = ThreadingHTTPServer(('127.0.0.1', 8123), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    session = BrowserSession(
        headless=True,
        user_data_dir=None,
        keep_alive=False,
        enable_default_extensions=False,
        highlight_elements=False,
        viewport={'width': 1280, 'height': 800},
    )
    if session.browser_profile.enable_default_extensions:
        raise RuntimeError('default extensions were not disabled')
    try:
        await session.start()
        await session.navigate_to('http://127.0.0.1:8123/')
        cdp = await session.get_or_create_cdp_session()
        value = None
        for _ in range(100):
            result = await cdp.cdp_client.send.Runtime.evaluate(
                params={
                    'expression': "({title:document.title,marker:document.querySelector('#ready')?.textContent||null,url:location.href})",
                    'returnByValue': True,
                },
                session_id=cdp.session_id,
            )
            value = result.get('result', {}).get('value')
            if value and value.get('title') == 'Jet Benchmark' and value.get('marker') == 'runtime-ready': break
            await asyncio.sleep(0.02)
        if not value or value.get('title') != 'Jet Benchmark' or value.get('marker') != 'runtime-ready' or not value.get('url', '').startswith('http://127.0.0.1:8123'):
            raise RuntimeError('fixture verification failed: ' + repr(value))
        print('JET_BENCH_READY ' + json.dumps({'fixtureVerified': True}), flush=True)
        checked = await cdp.cdp_client.send.Runtime.evaluate(
            params={'expression': 'document.title', 'returnByValue': True},
            session_id=cdp.session_id,
        )
        if checked.get('result', {}).get('value') != 'Jet Benchmark': raise RuntimeError('script verification failed')
        screenshot = await session.take_screenshot(full_page=False)
        if not screenshot or len(screenshot) < 1000: raise RuntimeError('screenshot verification failed')
        print('JET_BENCH_MEASURE ' + json.dumps({'scriptVerified': True, 'screenshotBytes': len(screenshot)}), flush=True)
        await asyncio.sleep(5.0)
        print('JET_BENCH_DONE {}', flush=True)
    finally:
        await session.kill(); server.shutdown()
asyncio.run(main())
`;

async function browserUseSample({ image, name }) {
  await createContainer(name, image, [
    '--tmpfs=/data:rw,noexec,nosuid,size=64m,mode=1777',
    '--user=root',
    '--entrypoint=/bin/sh',
  ], [
    '-c',
    'chmod 0755 / && exec env HOME=/home/browseruse USER=browseruse LOGNAME=browseruse setpriv --reuid=browseruse --regid=browseruse --init-groups python -c "$1"',
    'browser-use-benchmark',
    browserUseProgram,
  ]);
  const started = performance.now();
  const child = spawn(process.env.DOCKER || 'docker', ['start', '-a', name], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = new LineQueue(child.stdout);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const completion = new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', code => code ? reject(Error(`Browser Use exited ${code}: ${stderr}`)) : resolvePromise());
  });
  const nextLine = () => Promise.race([lines.next(), completion.then(() => { throw Error('Browser Use exited before emitting its benchmark result'); })]);
  try {
    let ready;
    while (!ready) {
      const line = await nextLine();
      if (line.startsWith('JET_BENCH_READY ')) ready = JSON.parse(line.slice('JET_BENCH_READY '.length));
    }
    if (ready.fixtureVerified !== true) throw Error('Browser Use fixture verification failed');
    const browserReadyMs = Number((performance.now() - started).toFixed(2));
    let measure;
    while (!measure) {
      const line = await nextLine();
      if (line.startsWith('JET_BENCH_MEASURE ')) measure = JSON.parse(line.slice('JET_BENCH_MEASURE '.length));
    }
    if (measure.scriptVerified !== true) throw Error('Browser Use script verification failed');
    if (measure.screenshotBytes < 1000) throw Error('Browser Use screenshot verification failed');
    const memory = await activeMemoryMiB(name);
    let done;
    while (!done) {
      const line = await nextLine();
      if (line.startsWith('JET_BENCH_DONE ')) done = true;
    }
    await completion;
    return { status: 'passed', browserReadyMs, scriptVerified: true, activeMemoryMiB: memory };
  } finally {
    child.kill('SIGKILL');
    await removeContainer(name);
  }
}

async function serviceSample({ provider, image, name }) {
  const isSteel = provider === 'steel-browser';
  const ports = ['-p', '127.0.0.1::3000'];
  const browserlessCompatibility=provider==='browserless'
    ?['--user=root','--entrypoint=/bin/sh']
    :[];
  const browserlessCommand=provider==='browserless'
    ?['-lc','chmod 0755 / && exec env HOME=/home/blessuser USER=blessuser LOGNAME=blessuser setpriv --reuid=blessuser --regid=blessuser --init-groups ./scripts/start.sh']
    :[];
  await createContainer(name, image, [...ports,...browserlessCompatibility], browserlessCommand);
  const started = performance.now();
  try {
    await docker(['start', name]);
    const apiPort = await mappedPort(name, 3000);
    await waitForHttp(`http://127.0.0.1:${apiPort}/${isSteel ? 'v1/health' : 'pressure'}`);
    let socketUrl;
    if (isSteel) {
      const response = await fetch(`http://127.0.0.1:${apiPort}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: true, blockAds: false, skipFingerprintInjection: true, dimensions: { width: 1280, height: 800 } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw Error(`Steel session create failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
      const session = await response.json();
      const returned = new URL(session.websocketUrl || 'ws://localhost:9223');
      returned.hostname = '127.0.0.1';
      returned.port = String(apiPort);
      socketUrl = returned.href;
    } else {
      socketUrl = `ws://127.0.0.1:${apiPort}`;
    }
    const verified = await verifyCdpRuntime(socketUrl, {
      started,
      sampleMemory: () => activeMemoryMiB(name),
    });
    return { status: 'passed', ...verified };
  } finally {
    await removeContainer(name);
  }
}

async function sample(provider, image, run) {
  const name = `jet-bench-${provider.replace(/[^a-z0-9]/g, '-')}-${process.pid}-${run}`;
  const started = performance.now();
  try {
    const value = provider === 'jet'
      ? await jetSample({ image, name })
      : provider === 'browser-use'
        ? await browserUseSample({ image, name })
        : await serviceSample({ provider, image, name });
    return { run, ...value };
  } catch (error) {
    return { run, status: 'failed', elapsedMs: Number((performance.now() - started).toFixed(2)), error: safeError(error) };
  }
}

async function systemInformation() {
  const [kernel, cpu, dockerVersion] = await Promise.all([
    command('uname', ['-srmo']),
    command('sh', ['-c', "awk -F: '/model name/{gsub(/^ +/,\"\",$2); print $2; exit}' /proc/cpuinfo"]),
    docker(['version', '--format', '{{.Server.Version}}']),
  ]);
  return {
    os: kernel.stdout,
    architecture: process.arch,
    cpu: cpu.stdout,
    cpuLimit: 2,
    memoryLimitMiB: 1024,
    docker: dockerVersion.stdout,
    node: process.version,
  };
}

export async function runRuntimeSuite({ providers, runs, warmups, images, commits, manifest }) {
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    method: {
      task: 'offline-fixture-title-dom-script-and-screenshot-verification',
      runs,
      warmups,
      concurrency: 1,
      cpuLimit: 2,
      memoryLimitMiB: 1024,
      viewport: { width: 1280, height: 800 },
      networkTarget: 'container-local fixture only',
      browserReady: 'docker start to verified title and DOM marker',
      memory: 'Docker working-set snapshot after title, DOM, script, and screenshot verification while the browser remained active',
      order: providers,
    },
    system: await systemInformation(),
    implementations: {},
  };
  for (const provider of providers) {
    const source = provider === 'jet' ? { commit: commits.jet, license: 'Apache-2.0' } : manifest.implementations[provider];
    if (!source?.commit || !images[provider]) throw Error(`Missing image or source commit for ${provider}`);
    for (let run = 1; run <= warmups; run += 1) await sample(provider, images[provider], `warmup-${run}`);
    const samples = [];
    for (let run = 1; run <= runs; run += 1) samples.push(await sample(provider, images[provider], run));
    report.implementations[provider] = {
      commit: source.commit,
      license: source.license,
      image: images[provider],
      imageDigest: await imageDigest(images[provider]),
      ...(provider==='browser-use'?{
        baseImage: images['browser-use-base'],
        baseImageDigest: await imageDigest(images['browser-use-base']),
      }:{}),
      ...(provider==='browser-use'?{runtimeNormalization:'Use a permission-only overlay that restores normal read/traverse access to the ACL-built /app tree before timed samples. Back the image-declared /data scratch volume with a 64 MiB tmpfs because the benchmark host volume driver cannot set POSIX ACL xattrs. Normalize OCI root traversal inside timed startup, then immediately drop back to the image default browseruse user.'}:{}),
      ...(provider==='browserless'?{runtimeNormalization:'Normalize OCI root traversal, then drop back to the image default blessuser before startup.'}:{}),
      samples,
    };
  }
  return report;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const providers = (args.providers || defaultProviders.join(',')).split(',').filter(Boolean);
  if (!providers.length || providers.some(provider => !defaultProviders.includes(provider))) throw Error('Unknown or missing provider');
  const runs = Number(args.runs || 5);
  const warmups = Number(args.warmups || 1);
  if (!Number.isInteger(runs) || runs < 1 || runs > 30) throw Error('runs must be 1–30');
  if (!Number.isInteger(warmups) || warmups < 0 || warmups > 5) throw Error('warmups must be 0–5');
  const manifest = JSON.parse(await readFile(new URL('./competitors.lock.json', import.meta.url), 'utf8'));
  const report = await runRuntimeSuite({
    providers,
    runs,
    warmups,
    manifest,
    commits: { jet: args['jet-commit'] || process.env.JET_BROWSER_COMMIT },
    images: {
      jet: args['jet-image'] || 'jet-browser:bench-20261007',
      'browser-use': args['browser-use-image'] || 'browser-use:bench-20261007-normalized',
      'browser-use-base': args['browser-use-base-image'] || 'browser-use:bench-20261007',
      'steel-browser': args['steel-image'] || 'steel-browser:bench-20261007',
      browserless: args['browserless-image'] || 'ghcr.io/browserless/chromium:v2.57.0',
    },
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, output, { mode: 0o644 });
  } else process.stdout.write(output);
  try { validateRuntimeReport(report); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}

export { parseMemoryMiB, safeError };
