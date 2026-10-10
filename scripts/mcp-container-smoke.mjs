import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/mcp-container-smoke.mjs <image>');

const transport = new StdioClientTransport({
  command: 'docker',
  args: [
    'run', '--rm', '-i', '--platform=linux/amd64', '--network=none',
    '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
    image,
  ],
  stderr: 'pipe',
});
const client = new Client({ name: 'jet-browser-mcp-container-smoke', version: '1.0.0' });

function leftoverVerifierContainers() {
  return execFileSync('docker', [
    'ps', '-a', '--filter', 'name=jet-browser-smoke-', '--format', '{{.Names}}',
  ], { encoding: 'utf8' }).trim();
}

try {
  assert.equal(leftoverVerifierContainers(), '');
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'jet_browser_capabilities',
    'jet_browser_verify',
  ]);
  const response = await client.callTool({ name: 'jet_browser_capabilities', arguments: {} });
  assert.equal(response.isError, undefined);
  assert.equal(response.structuredContent.runtime, 'WPE WebKit 2.54');
  assert.equal(response.structuredContent.browserNetwork, 'disabled');
  assert.match(response.content[0].text, /No public-web navigation/);

  const verification = await client.callTool({ name: 'jet_browser_verify', arguments: {} });
  assert.equal(verification.isError, undefined);
  assert.equal(verification.structuredContent.status, 'passed');
  assert.equal(verification.structuredContent.network, 'disabled');
  assert.equal(verification.structuredContent.title, 'Jet Browser Ready');
  assert.equal(verification.structuredContent.input, 'open-source runtime');
  assert.ok(verification.structuredContent.screenshotBytes >= 1000);
  assert.match(verification.structuredContent.image, /^ghcr\.io\/masakaai\/jet-browser@sha256:[a-f0-9]{64}$/);
  assert.equal(leftoverVerifierContainers(), '');
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    image,
    tools: tools.length,
    screenshotBytes: verification.structuredContent.screenshotBytes,
    cleanup: 'passed',
  })}\n`);
} finally {
  await client.close();
}
