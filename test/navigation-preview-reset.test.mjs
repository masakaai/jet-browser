import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/wpe-worker.mjs', import.meta.url), 'utf8');

test('direct navigation resets preview before starting the new document', () => {
  const navigate = source.slice(source.indexOf('control.navigate='), source.indexOf('control.switchTab='));
  const reset = navigate.indexOf("resetTabPreview('navigate')");
  const open = navigate.indexOf('beginNavigationWithWait(');
  assert.ok(reset >= 0, 'navigation must announce a preview generation reset');
  assert.ok(open > reset, 'preview reset must be sent before the new document starts');
});
