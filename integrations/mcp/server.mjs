#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { runStandaloneSmoke } from '../../scripts/standalone-runner.mjs';

const integrationDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(integrationDir, '../..');

export const JET_BROWSER_IMAGE = 'ghcr.io/masakaai/jet-browser@sha256:540a1fec531bf71b62c2c2d030c033249955ffc192ab7e0e7a1ac8d8412a661b';

const CAPABILITIES = Object.freeze({
  runtime: 'WPE WebKit 2.54',
  platform: 'linux/amd64',
  image: JET_BROWSER_IMAGE,
  browserNetwork: 'disabled',
  evidence: [
    'browser startup',
    'local document readiness',
    'native text input',
    'DOM state',
    'fresh PNG screenshot',
    'container cleanup',
  ],
  boundaries: [
    'No public-web navigation',
    'No CDP or personal-browser attachment',
    'No profile or credential access',
    'No hosted service or telemetry',
  ],
});

const verificationOutputSchema = z.object({
  status: z.literal('passed'),
  network: z.literal('disabled'),
  title: z.literal('Jet Browser Ready'),
  input: z.literal('open-source runtime'),
  screenshotBytes: z.number().int().min(1000),
  image: z.literal(JET_BROWSER_IMAGE),
});

const capabilitiesOutputSchema = z.object({
  runtime: z.literal(CAPABILITIES.runtime),
  platform: z.literal(CAPABILITIES.platform),
  image: z.literal(JET_BROWSER_IMAGE),
  browserNetwork: z.literal(CAPABILITIES.browserNetwork),
  evidence: z.array(z.string()),
  boundaries: z.array(z.string()),
});

let activeVerification = false;

function childEnvironment() {
  const allowed = [
    'PATH',
    'HOME',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'XDG_RUNTIME_DIR',
  ];
  const environment = {};
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return {
    ...environment,
    DOCKER: 'docker',
    DOCKER_DEFAULT_PLATFORM: 'linux/amd64',
    JET_BROWSER_IMAGE,
  };
}

function parseVerificationOutput(stdout) {
  let output;
  try {
    output = JSON.parse(stdout.trim());
  } catch {
    throw new Error('Jet Browser smoke test returned invalid JSON');
  }

  const parsed = verificationOutputSchema.omit({ image: true }).safeParse(output);
  if (!parsed.success) {
    throw new Error('Jet Browser smoke test returned unexpected evidence');
  }
  return { ...parsed.data, image: JET_BROWSER_IMAGE };
}

export function sanitizeError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutRoot = raw.split(repositoryRoot).join('<jet-browser>');
  const withoutControls = withoutRoot.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return withoutControls.replace(/\s+/g, ' ').trim().slice(0, 1000) || 'Jet Browser verification failed';
}

export async function runStandaloneVerification({ verify = runStandaloneSmoke, signal } = {}) {
  if (activeVerification) {
    throw new Error('A Jet Browser verification is already in progress');
  }
  activeVerification = true;
  try {
    const output = await verify({
      root: repositoryRoot,
      image: JET_BROWSER_IMAGE,
      docker: 'docker',
      noBuild: true,
      environment: childEnvironment(),
      signal,
    });
    return parseVerificationOutput(JSON.stringify(output));
  } finally {
    activeVerification = false;
  }
}

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function createJetBrowserMcpServer() {
  const server = new McpServer(
    { name: 'jet-browser-verifier', version: '0.8.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'jet_browser_capabilities',
    {
      title: 'Describe the Jet Browser verifier',
      description: 'Return the immutable runtime, evidence contract, and safety boundaries without starting Docker.',
      inputSchema: z.object({}).strict(),
      outputSchema: capabilitiesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => toolResult(CAPABILITIES),
  );

  server.registerTool(
    'jet_browser_verify',
    {
      title: 'Verify the Jet Browser runtime',
      description: 'Run the pinned Jet Browser container with browser networking disabled and return native-input, DOM, and PNG evidence.',
      inputSchema: z.object({}).strict(),
      outputSchema: verificationOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (_arguments, context) => {
      try {
        return toolResult(await runStandaloneVerification({ signal: context.signal }));
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: sanitizeError(error) }],
        };
      }
    },
  );

  return server;
}

export function startJetBrowserMcpServer() {
  const handle = serveStdio(() => createJetBrowserMcpServer(), {
    onerror: error => process.stderr.write(`Jet Browser MCP error: ${sanitizeError(error)}\n`),
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await handle.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return handle;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) startJetBrowserMcpServer();
