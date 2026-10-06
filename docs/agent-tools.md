# Agent tool catalog

Jet Browser exposes framework-neutral browser tool declarations in sdk/tools.mjs. The catalog does not choose a model, system prompt, agent loop, account system, or hosted service.

## Compile a catalog

~~~js
import {
  compileToolCatalog,
  jetTools,
  jetToolsets
} from 'jet-browser/tools';

const safeBrowserTools = compileToolCatalog(jetToolsets.browser(), {
  namespace: 'research'
});

const trustedDeveloperTools = compileToolCatalog([
  ...jetToolsets.browser(),
  jetTools.drag(),
  jetTools.evaluate()
]);
~~~

Compiling declarations is pure and side-effect free. It never starts a browser or opens a network connection.

Every declaration has a stable, versioned identity such as jet.browser.navigate.v1. A model-facing name or namespace can change without changing that identity. Compilation rejects duplicate identities, duplicate names, invalid aliases, and invalid namespaces.

## Bind an executor

bindToolCatalog accepts any client object that implements the relevant operations. This keeps the tool layer independent from the process supervisor, container platform, and agent framework.

~~~js
import {
  bindToolCatalog,
  compileToolCatalog,
  jetToolsets
} from 'jet-browser/tools';

const catalog = compileToolCatalog(jetToolsets.browser());

// Implement this adapter with the standalone JSONL transport or your own
// distributed session supervisor.
const client = {
  snapshot: (sessionId, options) => runtime.call(sessionId, 'snapshot', {}, options),
  navigate: (sessionId, url, options) => runtime.call(sessionId, 'navigate', { url }, options),
  click: (sessionId, x, y, options) => runtime.call(sessionId, 'click', { x, y }, options),
  type: (sessionId, text, options) => runtime.call(sessionId, 'type', { text }, options),
  press: (sessionId, key, options) => runtime.call(sessionId, 'press', { key }, options),
  scroll: (sessionId, delta, options) => runtime.call(sessionId, 'scroll', { delta }, options),
  tabs: (sessionId, options) => runtime.call(sessionId, 'tabs', {}, options),
  newTab: (sessionId, options) => runtime.call(sessionId, 'newTab', {}, options),
  switchTab: (sessionId, handle, options) => runtime.call(sessionId, 'switchTab', { handle }, options),
  closeTab: (sessionId, handle, options) => runtime.call(sessionId, 'closeTab', { handle }, options)
};

const tools = bindToolCatalog(catalog, {
  client,
  sessionId: 'local-session'
});

const navigate = tools.find(tool => tool.name === 'browser_navigate');
await navigate.execute({ url: 'https://arxiv.org/' });
~~~

The standalone protocol uses lower-level operation names in a few places, so the adapter is also the correct place to translate tool operations into JSONL commands and enforce session timeouts.

## Toolsets

- jetToolsets.browser() is the default set: snapshot, navigation, click, text, key, scroll, and tab lifecycle.
- jetToolsets.full() adds drag and arbitrary page JavaScript evaluation. Use it only for trusted developer agents.
- Individual factories under jetTools can build a smaller allowlist.

All tool inputs are checked locally before execution. Coordinates are viewport pixels from the latest observation. Navigation accepts credential-free HTTP(S) URLs. Tabs must use handles returned by the current session.

## Framework adapters

The bound result uses plain objects containing name, description, inputSchema, and execute. An adapter for an LLM framework should translate those objects without changing their identities or schemas. Framework-specific retry, model compatibility, and transcript handling belong in that adapter, not in the browser executor.

Browser lifecycle remains owned by the caller. This prevents a menu render, model change, or tool availability probe from accidentally allocating a browser.
