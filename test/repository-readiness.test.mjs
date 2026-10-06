import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const locales = ['zh-CN', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR'];

test('public README has portable links and no private machine paths', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /\/Users\/|\/data0\/|deeptensor-wpe-/);
  assert.match(readme, /npm run standalone/);
  assert.match(readme, /Dockerfile\.standalone/);
  for (const locale of locales) await access(resolve(root, `README.${locale}.md`));
  for (const path of ['docs/agent-tools.md', 'docs/architecture.md', 'docs/benchmarks.md', 'docs/comparison.md', 'docs/demo.md', 'Dockerfile.standalone', 'scripts/standalone-smoke.mjs', 'sdk/tools.mjs']) await access(resolve(root, path));
});

test('package and default worker versions stay aligned', async () => {
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const worker = await readFile(resolve(root, 'src/wpe-worker.mjs'), 'utf8');
  const cargo = await readFile(resolve(root, 'Cargo.toml'), 'utf8');
  const version = worker.match(/MASAKA_WORKER_VERSION\|\|'([^']+)'/)?.[1];
  assert.equal(version, packageJson.version);
  assert.match(cargo, new RegExp(`^version = "${packageJson.version.replaceAll('.', '\\.')}"$`, 'm'));
});

test('package exports preserve legacy SDK subpaths alongside stable aliases', async () => {
  const modern = await import('jet-browser');
  const legacyClient = await import('jet-browser/sdk/client.mjs');
  const legacyBrowser = await import('jet-browser/sdk/browser.mjs');
  assert.equal(modern.JetBrowser, legacyClient.JetBrowser);
  assert.equal(typeof legacyBrowser.MasakaBrowserClient, 'function');
  assert.equal(typeof (await import('jet-browser/tools')).compileToolCatalog, 'function');
  assert.equal(typeof (await import('jet-browser/sdk/transport.mjs')).MasakaTransport, 'function');
});
