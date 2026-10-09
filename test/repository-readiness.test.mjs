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

test('issue routing separates open-source discussion from managed support', async () => {
  const config = await readFile(resolve(root, '.github/ISSUE_TEMPLATE/config.yml'), 'utf8');
  const contacts = new Map([...config.matchAll(/^\s+- name: (.+)\n\s+url: (.+)\n\s+about: (.+)$/gm)]
    .map(([, name, url, about]) => [name, { url, about }]));
  assert.deepEqual(contacts.get('Open-source questions and ideas'), {
    url: 'https://github.com/masakaai/jet-browser/discussions',
    about: 'Ask questions, propose integrations, or share examples with the Jet Browser community.',
  });
  assert.deepEqual(contacts.get('MASAKA managed service support'), {
    url: 'https://masaka-ai.vercel.app/docs/support/',
    about: 'Ask about MASAKA-managed browser infrastructure and account-specific support.',
  });
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

test('stable releases publish an attested standalone image from the release tag', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/publish-container.yml'), 'utf8');
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

  assert.match(workflow, /^\s*release:\s*\n\s+types: \[published\]/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request):/m);
  assert.match(workflow, /github\.event\.release\.prerelease == false/);
  for (const permission of ['contents: read', 'packages: write', 'attestations: write', 'id-token: write']) {
    assert.match(workflow, new RegExp(permission));
  }
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /RELEASE_REF: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /git fetch --force --depth=1 origin "\$RELEASE_REF"/);
  assert.match(workflow, /FETCH_HEAD\^\{commit\}/);
  assert.match(workflow, /IMAGE_NAME: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /file: \.\/Dockerfile\.standalone/);
  assert.match(workflow, /flavor: latest=false/);
  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/);
  assert.doesNotMatch(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}|type=raw,value=latest/);
  assert.match(workflow, /subject-digest: \$\{\{ steps\.push\.outputs\.digest \}\}/);

  assert.match(readme, new RegExp(`ghcr\\.io/masakaai/jet-browser:${packageJson.version.replaceAll('.', '\\.')}\\b`));
  assert.doesNotMatch(readme, /ghcr\.io\/masakaai\/jet-browser:latest/);
  assert.match(readme, /--platform=linux\/amd64/);
  assert.match(readme, /Published from a tagged GitHub release/);
});

test('the root action runs the published runtime smoke flow without user secrets', async () => {
  const action = await readFile(resolve(root, 'action.yml'), 'utf8');
  const workflow = await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8');
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

  assert.match(action, /^name: Jet Browser Runtime Smoke Test$/m);
  assert.match(action, /^  using: composite$/m);
  assert.match(action, /uses: actions\/setup-node@[0-9a-f]{40}/);
  assert.match(action, /node-version: 24/);
  assert.match(action, new RegExp(`default: ghcr\\.io/masakaai/jet-browser:${packageJson.version.replaceAll('.', '\\.')}\\b`));
  assert.match(action, /docker pull --platform=linux\/amd64 "\$JET_BROWSER_IMAGE"/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/scripts\/standalone-smoke\.mjs" --no-build/);
  assert.match(action, /DOCKER_DEFAULT_PLATFORM: linux\/amd64/);
  assert.match(action, /ensure_sysctl .* kernel\.unprivileged_userns_clone 1/);
  assert.match(action, /ensure_sysctl .* kernel\.apparmor_restrict_unprivileged_userns 0/);
  assert.doesNotMatch(action, /secrets\.|github\.token|GITHUB_TOKEN/);
  assert.match(workflow, /uses: \.\//);
  assert.doesNotMatch(workflow, /sysctl -w/);
  assert.match(readme, new RegExp(`uses: masakaai/jet-browser@v${packageJson.version.replaceAll('.', '\\.')}\\b`));
  assert.match(readme, /https:\/\/github\.com\/marketplace\/actions\/jet-browser-runtime-smoke-test/);
});

test('the portable Agent Plugin manifest stays schema-clean', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'plugins/jet-browser/plugin.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.interface, undefined);
});
