import { MasakaBrowser } from '../sdk/client.mjs';

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const apiKey = process.env.MASAKA_API_KEY;
if (!apiKey) throw Error('Set MASAKA_API_KEY to a server-side key from the MASAKA dashboard');

const url = new URL(option('url', 'https://example.com'));
if (!['http:', 'https:'].includes(url.protocol)) throw Error('The demo URL must use http or https');

const region = option('region', process.env.MASAKA_BROWSER_REGION || 'overseas');
const maxSeconds = Number(option('max-seconds', '120'));
if (!Number.isInteger(maxSeconds) || maxSeconds < 30 || maxSeconds > 3600) {
  throw Error('--max-seconds must be an integer from 30 to 3600');
}

const browser = new MasakaBrowser({
  apiKey,
  baseUrl: process.env.MASAKA_API_ORIGIN || 'https://masaka-backend.vercel.app'
});

let session;
const started = performance.now();
try {
  session = await browser.create({
    url: url.href,
    region,
    maxSeconds,
    name: 'Jet Browser quickstart'
  });
  const running = await browser.waitForReady(session.id, { timeout: 90_000 });
  const evaluated = await browser.evaluate(session.id, `({title: document.title, url: location.href})`);
  if (evaluated?.evaluation?.exceptionDetails) throw Error(evaluated.evaluation.exceptionDetails.text || 'Browser evaluation failed');
  const page = evaluated?.evaluation?.result?.value ?? evaluated?.value ?? evaluated;
  if (!page?.title) throw Error('The target page did not expose a title');
  console.log(JSON.stringify({
    status: 'passed',
    sessionId: session.id,
    worker: running.worker_id || null,
    region: running.region || region,
    startupMs: Math.round(performance.now() - started),
    title: page?.title || null,
    url: page?.url || running.url || url.href
  }, null, 2));
} finally {
  if (session) await browser.stop(session.id).catch(error => {
    console.error(`Session cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
