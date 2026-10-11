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

test('public README explains product fit before asking readers to study benchmarks', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  const productFit = readme.indexOf('## Pick Jet Browser when');
  const benchmark = readme.indexOf('## Reproducible runtime benchmark');
  const quickStart = readme.indexOf('## Quick start');

  assert.ok(productFit > 0 && productFit < benchmark);
  assert.ok(benchmark < quickStart);

  const productFitSection = readme.slice(productFit, benchmark);
  const fragments = [...productFitSection.matchAll(/\[[^\]]+\]\((#[^)]+)\)/g)].map(([, fragment]) => fragment.slice(1));
  const headingSlugs = new Set([...readme.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) => heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')));

  assert.equal(fragments.length, 2);
  for (const fragment of fragments) assert.ok(headingSlugs.has(fragment), `Missing README heading for #${fragment}`);
});

test('coding-agent verification prompt uses the public Docker-only proof', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  const promptStart = readme.indexOf('## Let your coding agent verify it');
  const promptEnd = readme.indexOf('## Quick start', promptStart);
  const prompt = readme.slice(promptStart, promptEnd);

  assert.ok(promptStart > 0 && promptEnd > promptStart);
  assert.match(prompt, /Confirm Docker is available/);
  assert.match(prompt, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/masakaai\/jet-browser\/main\/scripts\/try-jet\.sh \| sh/);
  assert.match(prompt, /Only source builds require Node\.js 24\+/);
  assert.doesNotMatch(prompt, /run npm run standalone/);
});

test('Simplified Chinese README keeps the benchmark and agent verification path upfront', async () => {
  const readme = await readFile(resolve(root, 'README.zh-CN.md'), 'utf8');
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const benchmark = readme.indexOf('## 可复现运行时 Benchmark');
  const agentVerification = readme.indexOf('## 让编码 Agent 自己完成验收');
  const quickStart = readme.indexOf('## 快速开始');
  const rationale = readme.indexOf('## 为什么选择 Jet Browser');

  assert.ok(benchmark > 0 && benchmark < agentVerification);
  assert.ok(agentVerification < quickStart && quickStart < rationale);
  assert.match(readme, /https:\/\/github\.com\/marketplace\/actions\/jet-browser-runtime-smoke-test/);
  assert.match(readme, /codex plugin marketplace add masakaai\/jet-browser --ref main/);
  assert.match(readme, /claude plugin marketplace add masakaai\/jet-browser/);
  assert.match(readme, /不要连接我的日用 Chrome Profile/);
  assert.match(readme, new RegExp(`ghcr\\.io/masakaai/jet-browser:${packageJson.version.replaceAll('.', '\\.')}\\b`));
});

test('localized READMEs lead with the Docker-only one-command proof', async () => {
  const quickStartHeadings = new Map([
    ['de', '## Schnellstart'],
    ['es', '## Inicio rápido'],
    ['fr', '## Démarrage rapide'],
    ['ja', '## クイックスタート'],
    ['ko', '## 빠른 시작'],
    ['pt-BR', '## Início rápido'],
    ['zh-CN', '## 快速开始'],
  ]);
  const command = 'curl -fsSL https://raw.githubusercontent.com/masakaai/jet-browser/main/scripts/try-jet.sh | sh';
  const clone = 'git clone https://github.com/masakaai/jet-browser.git';

  for (const [locale, heading] of quickStartHeadings) {
    const readme = await readFile(resolve(root, `README.${locale}.md`), 'utf8');
    const quickStart = readme.indexOf(heading);
    const commandIndex = readme.indexOf(command, quickStart);
    const cloneIndex = readme.indexOf(clone, quickStart);
    const proof = readme.slice(commandIndex, commandIndex + 1_500);

    assert.ok(quickStart > 0, `${locale} README is missing its quick-start heading`);
    assert.ok(commandIndex > quickStart, `${locale} README does not lead with the one-command proof`);
    assert.ok(cloneIndex === -1 || commandIndex < cloneIndex, `${locale} README asks readers to clone before the one-command proof`);
    assert.match(readme.slice(quickStart, commandIndex), /Docker/);
    assert.match(proof, /\[.+\]\(\.\/scripts\/try-jet\.sh\)/);
    assert.match(proof, /linux\/amd64/);
  }
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

test('stable releases publish and verify native multi-arch images from the release tag', async () => {
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
  assert.equal(
    (workflow.match(/uses: docker\/github-builder\/\.github\/workflows\/build\.yml@58cb9f5b71b1836d6f690c1e95effdeb9b98cb8a/g) || []).length,
    2,
  );
  assert.equal((workflow.match(/platforms: linux\/amd64,linux\/arm64/g) || []).length, 2);
  assert.equal((workflow.match(/sbom: true/g) || []).length, 2);
  assert.equal((workflow.match(/sign: 'true'/g) || []).length, 2);
  assert.match(workflow, /meta-images: ghcr\.io\/\$\{\{ github\.repository \}\}/);
  assert.match(workflow, /file: \.\/Dockerfile\.standalone/);
  assert.match(workflow, /meta-flavor: latest=false/);
  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/);
  assert.doesNotMatch(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}|type=raw,value=latest/);
  assert.match(workflow, /JET_BROWSER_RUNTIME_IMAGE=ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ needs\.publish-runtime\.outputs\.digest \}\}/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.match(workflow, /runner: ubuntu-24\.04-arm[\s\S]*?platform: linux\/arm64/);
  assert.match(workflow, /runner: ubuntu-24\.04[\s\S]*?platform: linux\/amd64/);
  assert.match(workflow, /uses: \.\//);
  assert.match(workflow, /MCP_IMAGE: ghcr\.io\/\$\{\{ github\.repository \}\}-mcp@\$\{\{ needs\.publish-mcp\.outputs\.digest \}\}/);
  assert.match(workflow, /mcp-container-smoke\.mjs "\$MCP_IMAGE" "\$EXPECTED_PLATFORM" "\$RUNTIME_IMAGE"/);
  assert.doesNotMatch(workflow, /setup-qemu-action/);

  assert.match(readme, new RegExp(`ghcr\\.io/masakaai/jet-browser:${packageJson.version.replaceAll('.', '\\.')}\\b`));
  assert.doesNotMatch(readme, /ghcr\.io\/masakaai\/jet-browser:latest/);
  assert.match(readme, /linux\/amd64/);
  assert.match(readme, /linux\/arm64/);
  assert.match(readme, /multi-platform manifest/);
  assert.doesNotMatch(readme, /docker pull --platform=linux\/amd64/);
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
  assert.match(action, /^  platform:\n[\s\S]*?default: ''/m);
  assert.match(action, /uname -m/);
  assert.match(action, /x86_64\) platform=linux\/amd64/);
  assert.match(action, /aarch64\|arm64\) platform=linux\/arm64/);
  assert.match(action, /steps\.resolve-platform\.outputs\.platform/);
  assert.match(action, /docker pull --platform="\$JET_BROWSER_PLATFORM" "\$JET_BROWSER_IMAGE"/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/scripts\/standalone-smoke\.mjs" --no-build/);
  assert.match(action, /DOCKER_DEFAULT_PLATFORM: \$\{\{ steps\.resolve-platform\.outputs\.platform \}\}/);
  assert.match(action, /ensure_sysctl .* kernel\.unprivileged_userns_clone 1/);
  assert.match(action, /ensure_sysctl .* kernel\.apparmor_restrict_unprivileged_userns 0/);
  assert.doesNotMatch(action, /secrets\.|github\.token|GITHUB_TOKEN/);
  assert.match(workflow, /uses: \.\//);
  assert.match(workflow, /runs-on: ubuntu-24\.04-arm/);
  assert.match(workflow, /platform: linux\/arm64/);
  assert.match(workflow, /docker image inspect jet-browser:arm64/);
  assert.match(workflow, /mcp-container-smoke\.mjs jet-browser-mcp:arm64 linux\/arm64 jet-browser:arm64/);
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
