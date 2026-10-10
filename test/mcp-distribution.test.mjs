import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('MCP OCI package is registry-owned, network-disabled, and version-aligned', async () => {
  const [dockerfile, metadataText, packageText, workflow, readme, smoke] = await Promise.all([
    read('Dockerfile.mcp'),
    read('server.json'),
    read('package.json'),
    read('.github/workflows/publish-container.yml'),
    read('integrations/mcp/README.md'),
    read('scripts/mcp-container-smoke.mjs'),
  ]);
  const metadata = JSON.parse(metadataText);
  const packageJson = JSON.parse(packageText);
  const mcpPackage = metadata.packages[0];

  assert.equal(metadata.name, 'io.github.masakaai/jet-browser');
  assert.equal(metadata.version, packageJson.version);
  assert.ok(metadata.description.length <= 100);
  assert.equal(mcpPackage.registryType, 'oci');
  assert.equal(mcpPackage.version, undefined);
  assert.equal(mcpPackage.identifier, `ghcr.io/masakaai/jet-browser-mcp:${packageJson.version}`);
  assert.equal(mcpPackage.transport.type, 'stdio');
  assert.deepEqual(mcpPackage.runtimeArguments.map(({ name, value }) => [name, value]), [
    ['--platform', 'linux/amd64'],
    ['--network', 'none'],
    ['--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock'],
  ]);

  assert.match(dockerfile, /^FROM node:24-alpine$/m);
  assert.match(dockerfile, /apk add --no-cache docker-cli/);
  assert.match(dockerfile, /io\.modelcontextprotocol\.server\.name="io\.github\.masakaai\/jet-browser"/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "integrations\/mcp\/server\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /COPY \. \.|docker:dind|dockerd/);

  assert.match(workflow, /MCP_IMAGE_NAME: \$\{\{ github\.repository \}\}-mcp/);
  assert.match(workflow, /file: \.\/Dockerfile\.mcp/);
  assert.match(workflow, /subject-name: \$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.MCP_IMAGE_NAME \}\}/);
  assert.match(readme, /Docker socket grants host-level control/);
  assert.match(readme, /--platform=linux\/amd64/);
  assert.match(readme, /--network=none/);
  assert.match(smoke, /name: 'jet_browser_verify'/);
  assert.match(smoke, /leftoverVerifierContainers/);
  assert.match(smoke, /type=bind,src=\/var\/run\/docker\.sock,dst=\/var\/run\/docker\.sock/);
});
