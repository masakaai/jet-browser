import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindToolCatalog,
  compileToolCatalog,
  jetTools,
  jetToolsets
} from '../sdk/tools.mjs';

test('framework-neutral browser tools keep stable identities and safe defaults', () => {
  const catalog = compileToolCatalog(jetToolsets.browser());
  assert.deepEqual(catalog.map(tool => tool.identity), [
    'masaka.browser.snapshot.v1',
    'masaka.browser.navigate.v1',
    'masaka.browser.click.v1',
    'masaka.browser.type.v1',
    'masaka.browser.press.v1',
    'masaka.browser.scroll.v1',
    'masaka.browser.list-tabs.v1',
    'masaka.browser.new-tab.v1',
    'masaka.browser.switch-tab.v1',
    'masaka.browser.close-tab.v1'
  ]);
  assert.equal(catalog.some(tool => tool.name === 'browser_evaluate'), false);
  assert.equal(Object.isFrozen(catalog), true);
});

test('tool catalog compilation rejects identity and model-facing name collisions', () => {
  assert.throws(() => compileToolCatalog([jetTools.snapshot(), jetTools.snapshot()]), /Duplicate tool identity/);
  assert.throws(() => compileToolCatalog([
    jetTools.snapshot({ name: 'browser_action' }),
    jetTools.navigate({ name: 'browser_action' })
  ]), /Duplicate tool name/);
});

test('bound tools validate input before invoking one shared browser session', async () => {
  const calls = [];
  const client = {
    navigate: async (...values) => { calls.push(['navigate', ...values]); return { url: values[1] }; },
    click: async (...values) => { calls.push(['click', ...values]); return { clicked: true }; }
  };
  const tools = bindToolCatalog(compileToolCatalog([jetTools.navigate(), jetTools.click()]), {
    client,
    sessionId: 'session-1'
  });
  assert.deepEqual(await tools[0].execute({ url: 'https://example.com/' }), { url: 'https://example.com/' });
  assert.deepEqual(await tools[1].execute({ x: 12, y: 34 }), { clicked: true });
  assert.deepEqual(calls, [
    ['navigate', 'session-1', 'https://example.com/', undefined],
    ['click', 'session-1', 12, 34, undefined]
  ]);
  await assert.rejects(tools[1].execute({ x: -1, y: 34 }), /x must be/);
  assert.equal(calls.length, 2);
});

test('bound tools propagate cancellation to the client operation', async () => {
  const controller = new AbortController();
  let received;
  const client = {
    click: async (_sessionId, _x, _y, options) => {
      received = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
  };
  const [tool] = bindToolCatalog(compileToolCatalog([jetTools.click()]), { client, sessionId: 'session-1' });
  const pending = tool.execute({ x: 1, y: 2 }, { signal: controller.signal });
  controller.abort(Error('cancel tool'));
  await assert.rejects(pending, /cancel tool/);
  assert.equal(received, controller.signal);
});

test('catalog namespaces preserve identity while producing deterministic names', () => {
  const catalog = compileToolCatalog([jetTools.snapshot(), jetTools.navigate()], { namespace: 'research' });
  assert.deepEqual(catalog.map(tool => tool.name), ['research_browser_snapshot', 'research_browser_navigate']);
  assert.deepEqual(catalog.map(tool => tool.identity), ['masaka.browser.snapshot.v1', 'masaka.browser.navigate.v1']);
  assert.throws(() => compileToolCatalog([jetTools.snapshot()], { namespace: 'not valid' }), /namespace/);
});
