import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root, path), 'utf8');

test('public project presentation is independent from a hosted platform', async () => {
  const readmes = await Promise.all([
    'README.md', 'README.zh-CN.md', 'README.ja.md', 'README.ko.md',
    'README.de.md', 'README.fr.md', 'README.es.md', 'README.pt-BR.md'
  ].map(read));
  const publicGuides = await Promise.all([
    'docs/agent-tools.md', 'docs/architecture.md', 'docs/benchmarks.md',
    'docs/comparison.md', 'docs/demo.md', '.env.example', 'CONTRIBUTING.md',
    'examples/quickstart.mjs'
  ].map(read));
  for (const value of [...readmes, ...publicGuides]) {
    assert.doesNotMatch(value, /behind MASAKA|MASAKA 的|MASAKA の|MASAKA의|MASAKA ist|MASAKA est|MASAKA es|MASAKA é/i);
  }
  const companionLinks = [
    'https://masaka-ai.vercel.app/jet-browser/',
    'https://masaka-ai.vercel.app/jet-browser/tech-report/',
  ];
  for (const link of companionLinks) assert.match(readmes[0], new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const primaryWithoutCompanionLinks = companionLinks.reduce((value, link) => value.replaceAll(link, ''), readmes[0]);
  const hostedDependency = /masaka-backend|Vercel|Supabase|Postgres|\bKernel\b/i;
  assert.doesNotMatch(primaryWithoutCompanionLinks, hostedDependency);
  for (const value of [...readmes.slice(1), ...publicGuides]) assert.doesNotMatch(value, hostedDependency);
  assert.doesNotMatch(primaryWithoutCompanionLinks, /\bMASAKA\b|masaka-ai\.vercel\.app/i);
  for (const value of [...readmes.slice(1), ...publicGuides]) assert.doesNotMatch(value, /\bMASAKA\b|masaka-ai\.vercel\.app/i);
  for (const value of readmes) {
    assert.match(value, /^<p align="center">\s*<img width="100%" src="\.\/docs\/assets\/jet-browser-banner\.svg"/);
    assert.match(value, /docs\/assets\/runtime-benchmark\.svg/);
    assert.match(value, /benchmarks\/results\/runtime-2026-10-07\.json/);
    assert.doesNotMatch(value, /7\/7|p50/i);
    assert.match(value, /npm run standalone/);
  }
  assert.match(readmes[0], /docs\/assets\/jet-browser-banner\.svg/);
  assert.match(readmes[0], /Dockerfile\.standalone/);
  assert.match(readmes[0], /No account, API key, model, database, or hosted control plane is required/);
});

test('standalone image has no hosted control-plane dependency', async () => {
  for (const path of ['Dockerfile.standalone', 'standalone-entrypoint.sh', 'scripts/standalone-smoke.mjs', 'scripts/standalone-readiness.mjs', 'scripts/standalone-fixture.rs', 'seccomp_profile.json', 'LICENSE']) {
    await access(resolve(root, path));
  }
  const dockerfile = await read('Dockerfile.standalone');
  const entrypoint = await read('standalone-entrypoint.sh');
  const smoke = await read('scripts/standalone-smoke.mjs');
  const readiness = await read('scripts/standalone-readiness.mjs');
  assert.doesNotMatch(dockerfile, /npm ci|@supabase|cloudflared|MASAKA_/i);
  assert.doesNotMatch(entrypoint, /SUPABASE|DATABASE|API_KEY|cloudflared/i);
  assert.match(entrypoint, /jet-wpe/);
  assert.match(smoke, /Dockerfile\.standalone/);
  assert.match(smoke, /systempaths=unconfined/);
  assert.match(smoke, /apparmor=unconfined/);
  assert.match(smoke, /seccomp=/);
  assert.match(smoke, /"op":"create"|op: 'create'/);
  assert.match(smoke, /op: 'navigate'/);
  assert.match(smoke, /waitForFixtureDocument/);
  assert.match(readiness, /op: 'document_state'/);
  assert.match(smoke, /page_load_strategy: 'none'/);
  assert.match(smoke, /type: 'pointer'/);
  assert.match(smoke, /type: 'text'/);
  assert.match(smoke, /"op":"close"|op: 'close'/);
});
