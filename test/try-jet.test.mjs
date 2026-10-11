import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolvePromise({ code, stdout, stderr }));
  });
}

async function writeExecutable(path, source) {
  await writeFile(path, source, { mode: 0o755 });
  await chmod(path, 0o755);
}

test('Docker-only try script verifies the pinned policy before the isolated smoke run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-try-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'docker.log');
  await mkdir(bin);

  try {
    await writeExecutable(join(bin, 'curl'), `#!/bin/sh
set -eu
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then output=$2; shift 2; else shift; fi
done
cp "$JET_BROWSER_TEST_SECCOMP" "$output"
`);
    await writeExecutable(join(bin, 'docker'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$JET_BROWSER_TEST_LOG"
case "$1" in
  info|pull|rm) exit 0 ;;
  run)
    cat >/dev/null
    printf '%s\\n' \
      '{"ok":true,"value":{"sessionId":"fixture"}}' \
      '{"ok":true,"value":null}' \
      '{"ok":true,"value":null}' \
      '{"ok":true,"value":{"result":{"value":{"value":"open-source runtime","result":"open-source runtime"}}}}' \
      '{"ok":true,"value":{"title":"Jet Browser Ready","url":"http://127.0.0.1:8080/"}}' \
      '{"ok":true,"value":"iVBORw0KGgoAAAANSUhEUgAA"}' \
      '{"ok":true,"value":null}'
    ;;
  *) exit 9 ;;
esac
`);

    const result = await run('sh', ['-c', 'cat scripts/try-jet.sh | sh'], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        JET_BROWSER_TEST_LOG: log,
        JET_BROWSER_TEST_SECCOMP: join(root, 'seccomp_profile.json'),
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"status":"passed"/);
    assert.match(result.stdout, /"network":"disabled"/);
    assert.match(result.stdout, /"nativeInput":"verified"/);
    assert.match(result.stdout, /"screenshot":"verified PNG"/);

    const calls = await readFile(log, 'utf8');
    assert.match(calls, /^info$/m);
    assert.match(calls, /^pull --platform=linux\/amd64 ghcr\.io\/masakaai\/jet-browser@sha256:0aeb9144beba4ca9a2445e653fe42d6ea525b9fee41bc78c05d468ffd6daaa4b$/m);
    assert.match(calls, /run --rm -i --name jet-browser-try-[0-9]+ --platform=linux\/amd64 --network=none --cap-drop=ALL/);
    assert.match(calls, /--security-opt=no-new-privileges/);
    assert.match(calls, /--security-opt=seccomp=.*seccomp_profile\.json/);
    assert.doesNotMatch(calls, /--privileged|docker\.sock|--network=(?!none)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Docker-only try script fails closed before pulling or running on a policy mismatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-try-mismatch-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'docker.log');
  await mkdir(bin);

  try {
    await writeExecutable(join(bin, 'curl'), `#!/bin/sh
set -eu
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then output=$2; shift 2; else shift; fi
done
printf '{}\\n' > "$output"
`);
    await writeExecutable(join(bin, 'docker'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$JET_BROWSER_TEST_LOG"
exit 0
`);

    const result = await run('sh', [join(root, 'scripts/try-jet.sh')], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        JET_BROWSER_TEST_LOG: log,
      },
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /security policy checksum did not match/);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /^info$/m);
    assert.doesNotMatch(calls, /^pull |^run /m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Docker-only try script and README stay pinned to the released image', async () => {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const script = await readFile(join(root, 'scripts/try-jet.sh'), 'utf8');
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const workflow = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  const escaped = packageJson.version.replaceAll('.', '\\.');

  assert.match(script, new RegExp(`JET_BROWSER_VERSION='${escaped}'`));
  assert.match(script, /JET_BROWSER_IMAGE_DIGEST='sha256:0aeb9144beba4ca9a2445e653fe42d6ea525b9fee41bc78c05d468ffd6daaa4b'/);
  assert.match(script, /ghcr\.io\/masakaai\/jet-browser@\$\{JET_BROWSER_IMAGE_DIGEST\}/);
  assert.match(script, /5f4c3f92d6cf19fd6dfbbd4197e5a63546866ff8c1a3998e5c99bc589b2fcf11/);
  assert.match(readme, /scripts\/try-jet\.sh/);
  assert.match(readme, /Docker only—no clone, Node\.js, account, API key, or outbound browser network/);
  assert.match(workflow, /run: sh scripts\/try-jet\.sh/);
});
