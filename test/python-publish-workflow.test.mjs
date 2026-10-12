import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('successful stable container releases gate tokenless Python publishing', async () => {
  const [workflow, metadata, packageJson, documentation] = await Promise.all([
    read('.github/workflows/publish-python.yml'),
    read('integrations/python/pyproject.toml'),
    read('package.json'),
    read('integrations/python/README.md'),
  ]);
  const version = JSON.parse(packageJson).version;

  assert.match(workflow, /^name: publish-python$/m);
  assert.match(workflow, /^  workflow_run:\n    workflows: \[publish-container\]\n    types: \[completed\]/m);
  assert.doesNotMatch(workflow, /workflow_dispatch:|pull_request:|^  push:/m);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'release'/);
  assert.match(workflow, /ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_SHA"/);
  assert.match(workflow, /draft == false and \.prerelease == false/);
  assert.match(workflow, /python3 -m build integrations\/python --outdir dist\/python/);
  assert.match(workflow, /python3 -m twine check dist\/python\/\*/);
  assert.match(workflow, /verify_distribution\.py dist\/python/);
  assert.match(workflow, /name: jet-browser-python-package/);
  assert.match(workflow, /environment:\n      name: pypi\n      url: https:\/\/pypi\.org\/p\/jet-browser/);
  assert.match(workflow, /permissions:\n      id-token: write/);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 1);
  const publishJob = workflow.slice(workflow.indexOf('\n  publish:'));
  assert.doesNotMatch(publishJob, /actions\/checkout|\n\s+run:/);
  assert.match(workflow, /pypa\/gh-action-pypi-publish@dc37677b2e1c63e2034f94d8a5b11f265b73ba33/);
  assert.match(workflow, /packages-dir: dist\/python/);
  assert.match(workflow, /attestations: true/);
  assert.doesNotMatch(workflow, /password:|username:|skip-existing:/);
  assert.match(metadata, new RegExp(`version = "${version.replaceAll('.', '\\.') }"`));
  assert.match(documentation, /Release and rollback/);
  assert.match(documentation, /publish-python\.yml/);
  assert.match(documentation, /PyPI Trusted Publisher/);
  assert.match(documentation, /known-good commit/);
});

test('stable releases attach the exact verified Python distributions with isolated write permission', async () => {
  const [workflow, documentation] = await Promise.all([
    read('.github/workflows/publish-python.yml'),
    read('integrations/python/README.md'),
  ]);
  const releaseStart = workflow.indexOf('\n  attach-release-assets:');
  const publishStart = workflow.indexOf('\n  publish:');

  assert.ok(releaseStart > 0 && publishStart > releaseStart);
  const releaseJob = workflow.slice(releaseStart, publishStart);
  assert.match(releaseJob, /needs: build/);
  assert.match(releaseJob, /permissions:\n      contents: write/);
  assert.doesNotMatch(releaseJob, /id-token: write|environment:|actions\/checkout|gh-action-pypi-publish/);
  assert.match(releaseJob, /actions\/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333/);
  assert.match(releaseJob, /name: jet-browser-python-package/);
  assert.match(releaseJob, /path: dist\/python/);
  assert.match(releaseJob, /\[\[ "\$RELEASE_TAG" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$ \]\]/);
  assert.match(releaseJob, /EXPECTED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(releaseJob, /git\/ref\/tags\/\$RELEASE_TAG/);
  assert.match(releaseJob, /test "\$tag_sha" = "\$EXPECTED_SHA"/);
  assert.match(releaseJob, /\.draft == false and \.prerelease == false/);
  assert.match(releaseJob, /test "\$\{#wheels\[@\]\}" -eq 1/);
  assert.match(releaseJob, /test "\$\{#sdists\[@\]\}" -eq 1/);
  assert.match(releaseJob, /gh release upload "\$RELEASE_TAG"/);
  assert.match(releaseJob, /"\$\{wheels\[0\]\}" "\$\{sdists\[0\]\}"/);
  assert.match(releaseJob, /--clobber --repo "\$GITHUB_REPOSITORY"/);
  assert.match(documentation, /GitHub Release assets/);
  assert.match(documentation, /same verified wheel and source distribution/);
});
