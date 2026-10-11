import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRuntimeConfig } from '../scripts/render-mcp-runtime-config.mjs';

test('MCP runtime config renders an immutable image and supported platform', () => {
  assert.equal(
    renderRuntimeConfig('jet-browser:arm64', 'linux/arm64'),
    'export const JET_BROWSER_IMAGE = "jet-browser:arm64";\n' +
      'export const JET_BROWSER_PLATFORM = "linux/arm64";\n',
  );
});

test('MCP runtime config rejects unsafe images and unsupported platforms', () => {
  assert.throws(() => renderRuntimeConfig('jet-browser:arm64; echo unsafe', 'linux/arm64'), /Invalid.*image/);
  assert.throws(() => renderRuntimeConfig('jet-browser:arm64', 'linux/ppc64le'), /Invalid.*platform/);
});
