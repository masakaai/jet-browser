#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function renderRuntimeConfig(image, platform) {
  if (typeof image !== 'string' || image.length < 1 || image.length > 255 ||
      !/^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$/.test(image)) {
    throw new Error('Invalid Jet Browser runtime image');
  }
  if (!/^linux\/(amd64|arm64)$/.test(platform)) {
    throw new Error('Invalid Jet Browser runtime platform');
  }
  return [
    `export const JET_BROWSER_IMAGE = ${JSON.stringify(image)};`,
    `export const JET_BROWSER_PLATFORM = ${JSON.stringify(platform)};`,
    '',
  ].join('\n');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [target, image, platform] = process.argv.slice(2);
  if (!target) throw new Error('Usage: render-mcp-runtime-config.mjs <target> <image> <platform>');
  await writeFile(target, renderRuntimeConfig(image, platform), 'utf8');
}
