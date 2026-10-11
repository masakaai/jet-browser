import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('release benchmark records the same public image on native AMD64 and ARM64 runners', async () => {
  const workflow = await read('.github/workflows/benchmark-release.yml');

  assert.match(workflow, /^name: benchmark-release$/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|release|schedule):/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /id-token: write|packages: write|attestations: write/);
  assert.match(workflow, /runner: ubuntu-24\.04\n\s+platform: linux\/amd64\n\s+architecture: amd64/);
  assert.match(workflow, /runner: ubuntu-24\.04-arm\n\s+platform: linux\/arm64\n\s+architecture: arm64/);
  assert.match(workflow, /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /source_commit="\$\(git rev-parse "\$\{RELEASE_TAG\}\^\{commit\}"\)"/);
  assert.match(workflow, /git show "\$RELEASE_TAG:package\.json"/);
  assert.match(workflow, /uses: actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/);
  assert.match(workflow, /uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(workflow, /ghcr\.io\/masakaai\/jet-browser:\$version/);
  assert.match(workflow, /application\/vnd\.oci\.image\.index\.v1\+json/);
  assert.match(workflow, /docker-content-digest/);
  assert.match(workflow, /docker pull --platform="\$EXPECTED_PLATFORM" "\$RELEASE_IMAGE@\$MANIFEST_DIGEST"/);
  assert.match(workflow, /docker image inspect "\$RELEASE_IMAGE@\$MANIFEST_DIGEST" --format '\{\{\.Architecture\}\}'/);
  assert.match(workflow, /--providers=jet/);
  assert.match(workflow, /--runs=7/);
  assert.match(workflow, /--warmups=1/);
  assert.match(workflow, /--jet-commit="\$source_commit"/);
  assert.match(workflow, /--jet-image="\$RELEASE_IMAGE@\$MANIFEST_DIGEST"/);
  assert.match(workflow, /benchmark_status=\$\?/);
  assert.match(workflow, /\.implementations\.jet\.samples\[\] \| select\(\.status != "passed"\)/);
  assert.match(workflow, /error=\\\(\.error \/\/ "unknown"\)/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /name: Validate the native benchmark report/);
  assert.match(workflow, /validateRuntimeReport/);
  assert.match(workflow, /releaseTag/);
  assert.match(workflow, /harnessCommit/);
  assert.match(workflow, /manifestDigest/);
  assert.match(workflow, /platform/);
  assert.doesNotMatch(workflow, /setup-qemu-action|docker build|buildx build/);
});

test('release measurement uses the session strategy proven by the public smoke path', async () => {
  const suite = await read('benchmarks/runtime-suite.mjs');

  assert.match(suite, /page_load_strategy: 'none'/);
  assert.doesNotMatch(suite, /page_load_strategy: '(?:eager|normal)'/);
  assert.match(suite, /\[\s*'run', '--rm', '-i', '--name', name, '--network=none'/);
  assert.doesNotMatch(suite, /\['start', '-a', '-i', name\]/);
});
