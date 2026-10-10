import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  JET_BROWSER_IMAGE,
  runStandaloneVerification,
  sanitizeError,
} from '../integrations/mcp/server.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const serverPath = resolve(repositoryRoot, 'integrations/mcp/server.mjs');

const passingOutput = JSON.stringify({
  status: 'passed',
  network: 'disabled',
  title: 'Jet Browser Ready',
  input: 'open-source runtime',
  screenshotBytes: 2048,
});

test('verification pins the image and accepts complete smoke evidence', async () => {
  let options;
  const result = await runStandaloneVerification({
    verify: async received => {
      options = received;
      return JSON.parse(passingOutput);
    },
  });

  assert.deepEqual(result, {
    status: 'passed',
    network: 'disabled',
    title: 'Jet Browser Ready',
    input: 'open-source runtime',
    screenshotBytes: 2048,
    image: JET_BROWSER_IMAGE,
  });
  assert.equal(options.image, JET_BROWSER_IMAGE);
  assert.equal(options.docker, 'docker');
  assert.equal(options.noBuild, true);
  assert.equal(options.startupTimeoutMs, 45_000);
  assert.equal(options.environment.JET_BROWSER_IMAGE, JET_BROWSER_IMAGE);
  assert.equal(options.environment.DOCKER, 'docker');
  assert.equal(options.environment.DOCKER_DEFAULT_PLATFORM, 'linux/amd64');
});

test('verification rejects malformed or incomplete evidence', async () => {
  await assert.rejects(
    runStandaloneVerification({ verify: async () => 'not-an-object' }),
    /unexpected evidence/,
  );
  await assert.rejects(
    runStandaloneVerification({ verify: async () => ({ status: 'passed' }) }),
    /unexpected evidence/,
  );
});

test('verification refuses concurrent container runs and releases its gate', async () => {
  let release;
  let started;
  const hasStarted = new Promise(resolveStarted => { started = resolveStarted; });
  const first = runStandaloneVerification({
    verify: async () => {
      started();
      return new Promise(resolveVerification => { release = resolveVerification; });
    },
  });
  await hasStarted;

  await assert.rejects(
    runStandaloneVerification({ verify: async () => JSON.parse(passingOutput) }),
    /already in progress/,
  );
  release(JSON.parse(passingOutput));
  await first;

  const second = await runStandaloneVerification({
    verify: async () => JSON.parse(passingOutput),
  });
  assert.equal(second.status, 'passed');
});

test('error text removes repository paths, controls, and excess output', () => {
  const error = new Error(`${repositoryRoot}/private\u0000\n${'x'.repeat(1200)}`);
  const sanitized = sanitizeError(error);
  assert.doesNotMatch(sanitized, new RegExp(repositoryRoot));
  assert.doesNotMatch(sanitized, /\u0000/);
  assert.ok(sanitized.length <= 1000);
});

test('stdio server advertises only the bounded verifier tools', { timeout: 15_000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: repositoryRoot,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'jet-browser-mcp-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
      'jet_browser_capabilities',
      'jet_browser_verify',
    ]);

    const response = await client.callTool({ name: 'jet_browser_capabilities', arguments: {} });
    assert.equal(response.isError, undefined);
    assert.equal(response.structuredContent.runtime, 'WPE WebKit 2.54');
    assert.equal(response.structuredContent.image, JET_BROWSER_IMAGE);
    assert.equal(response.structuredContent.browserNetwork, 'disabled');
    assert.match(response.content[0].text, /No public-web navigation/);
  } finally {
    await client.close();
  }
});
