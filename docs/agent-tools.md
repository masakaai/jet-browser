# Agent tool catalog

Jet Browser exposes a framework-neutral browser tool catalog in `sdk/tools.mjs`. The catalog deliberately does not choose a model, system prompt, agent loop, or framework. It gives those layers stable declarations and binds them to one existing MASAKA browser session.

## Compile, then bind

```js
import { MasakaBrowser } from '../sdk/client.mjs';
import { bindToolCatalog, compileToolCatalog, jetToolsets } from '../sdk/tools.mjs';

const client = new MasakaBrowser({ apiKey: process.env.MASAKA_API_KEY });
const browser = await client.create({ maxSeconds: 120 });

try {
  await client.waitForReady(browser.id);

  // Pure and side-effect free: this does not allocate a browser.
  const catalog = compileToolCatalog(jetToolsets.browser(), {
    namespace: 'research'
  });

  // Every executable shares the same browser session and control capability.
  const tools = bindToolCatalog(catalog, {
    client,
    sessionId: browser.id
  });

  const navigate = tools.find(tool => tool.name === 'research_browser_navigate');
  await navigate.execute({ url: 'https://arxiv.org/' });
} finally {
  await client.stop(browser.id);
}
```

Each declaration has a stable, versioned identity such as `masaka.browser.navigate.v1`. A model-facing name or namespace can change without changing that identity. Compilation rejects duplicate identities, duplicate names, invalid aliases, and invalid namespaces before any browser request is made.

## Toolsets

- `jetToolsets.browser()` is the default set: snapshot, navigation, click, text, key, scroll, and tab lifecycle.
- `jetToolsets.full()` adds drag and arbitrary page JavaScript evaluation. Use it only for trusted developer agents.
- Individual factories under `jetTools` can build a smaller allowlist.

All tool inputs are checked locally before execution. Coordinates are viewport pixels from the latest observation. Navigation accepts credential-free HTTP(S) URLs. Tabs must use handles returned by the current session.

## Framework adapters

The bound result intentionally uses plain objects containing `name`, `description`, `inputSchema`, and `execute`. An adapter for an LLM framework should translate those objects without changing their identities or schemas. Framework-specific retry, model compatibility, and transcript handling belong in that adapter, not in the browser executor.

Compilation is declaration-only; browser lifecycle remains owned by the caller. This prevents a menu render, model change, or tool availability probe from accidentally creating a paid browser session.
