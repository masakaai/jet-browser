const namePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainInput(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Tool input must be an object');
  return value;
}

function shape(value, required = [], optional = []) {
  const input = plainInput(value), allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in input)) throw Error(`${key} is required`);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw Error(`Unexpected tool input: ${key}`);
  return input;
}

function text(value, label, { minimum = 1, maximum = 20_000 } = {}) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw Error(`${label} must be a string from ${minimum} to ${maximum} characters`);
  }
  return value;
}

function coordinate(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) throw Error(`${label} must be an integer from 0 to 65535`);
  return value;
}

function delta(value) {
  if (!Number.isInteger(value) || value < -100_000 || value > 100_000) throw Error('delta must be an integer from -100000 to 100000');
  return value;
}

function webUrl(value) {
  const url = new URL(text(value, 'url', { maximum: 2048 }));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('url must be an HTTP(S) URL without credentials');
  return url.href;
}

const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const coordinateProperties = {
  x: { type: 'integer', minimum: 0, maximum: 65535, description: 'Viewport x coordinate in pixels.' },
  y: { type: 'integer', minimum: 0, maximum: 65535, description: 'Viewport y coordinate in pixels.' }
};

function specification({ identity, name, description, inputSchema, operation, mutates, validate }) {
  return deepFreeze({ identity, preferredName: name, name, description, inputSchema, operation, mutates, validate });
}

function aliased(specificationValue, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('Tool options must be an object');
  if (Object.keys(options).some(key => key !== 'name')) throw Error('Unknown tool option');
  if (options.name === undefined) return specificationValue;
  if (!namePattern.test(options.name)) throw Error('Tool name must be a portable identifier');
  return deepFreeze({ ...specificationValue, name: options.name });
}

const definitions = {
  snapshot: specification({
    identity: 'jet.browser.snapshot.v1', name: 'browser_snapshot', operation: 'snapshot', mutates: false,
    description: 'Return the current browser snapshot and tab state. Refresh after navigation before relying on prior page state.',
    inputSchema: emptySchema, validate: input => shape(input)
  }),
  navigate: specification({
    identity: 'jet.browser.navigate.v1', name: 'browser_navigate', operation: 'navigate', mutates: true,
    description: 'Navigate the active tab to an HTTP(S) URL.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } }, required: ['url'], additionalProperties: false },
    validate(input) { const value = shape(input, ['url']); return { url: webUrl(value.url) }; }
  }),
  click: specification({
    identity: 'jet.browser.click.v1', name: 'browser_click', operation: 'click', mutates: true,
    description: 'Click viewport coordinates from the latest visual frame or snapshot.',
    inputSchema: { type: 'object', properties: coordinateProperties, required: ['x', 'y'], additionalProperties: false },
    validate(input) { const value = shape(input, ['x', 'y']); return { x: coordinate(value.x, 'x'), y: coordinate(value.y, 'y') }; }
  }),
  drag: specification({
    identity: 'jet.browser.drag.v1', name: 'browser_drag', operation: 'drag', mutates: true,
    description: 'Drag from one viewport coordinate to another.',
    inputSchema: { type: 'object', properties: { ...coordinateProperties, to_x: coordinateProperties.x, to_y: coordinateProperties.y }, required: ['x', 'y', 'to_x', 'to_y'], additionalProperties: false },
    validate(input) { const value = shape(input, ['x', 'y', 'to_x', 'to_y']); return { x: coordinate(value.x, 'x'), y: coordinate(value.y, 'y'), to_x: coordinate(value.to_x, 'to_x'), to_y: coordinate(value.to_y, 'to_y') }; }
  }),
  type: specification({
    identity: 'jet.browser.type.v1', name: 'browser_type', operation: 'type', mutates: true,
    description: 'Type literal text into the active element.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 20000 } }, required: ['text'], additionalProperties: false },
    validate(input) { const value = shape(input, ['text']); return { text: text(value.text, 'text') }; }
  }),
  press: specification({
    identity: 'jet.browser.press.v1', name: 'browser_press', operation: 'press', mutates: true,
    description: 'Press one key or supported key chord.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['key'], additionalProperties: false },
    validate(input) { const value = shape(input, ['key']); return { key: text(value.key, 'key', { maximum: 100 }) }; }
  }),
  scroll: specification({
    identity: 'jet.browser.scroll.v1', name: 'browser_scroll', operation: 'scroll', mutates: true,
    description: 'Scroll the active page by a signed pixel delta.',
    inputSchema: { type: 'object', properties: { delta: { type: 'integer', minimum: -100000, maximum: 100000 } }, required: ['delta'], additionalProperties: false },
    validate(input) { const value = shape(input, ['delta']); return { delta: delta(value.delta) }; }
  }),
  listTabs: specification({
    identity: 'jet.browser.list-tabs.v1', name: 'browser_list_tabs', operation: 'tabs', mutates: false,
    description: 'List browser tabs and the active tab.', inputSchema: emptySchema, validate: input => shape(input)
  }),
  newTab: specification({
    identity: 'jet.browser.new-tab.v1', name: 'browser_new_tab', operation: 'newTab', mutates: true,
    description: 'Open a new browser tab.', inputSchema: emptySchema, validate: input => shape(input)
  }),
  switchTab: specification({
    identity: 'jet.browser.switch-tab.v1', name: 'browser_switch_tab', operation: 'switchTab', mutates: true,
    description: 'Switch to a tab handle returned by browser_list_tabs.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['handle'], additionalProperties: false },
    validate(input) { const value = shape(input, ['handle']); return { handle: text(value.handle, 'handle', { maximum: 200 }) }; }
  }),
  closeTab: specification({
    identity: 'jet.browser.close-tab.v1', name: 'browser_close_tab', operation: 'closeTab', mutates: true,
    description: 'Close a tab handle returned by browser_list_tabs.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['handle'], additionalProperties: false },
    validate(input) { const value = shape(input, ['handle']); return { handle: text(value.handle, 'handle', { maximum: 200 }) }; }
  }),
  evaluate: specification({
    identity: 'jet.browser.evaluate.v1', name: 'browser_evaluate', operation: 'evaluate', mutates: true,
    description: 'Execute JavaScript in the active page. Include only for trusted developer agents.',
    inputSchema: { type: 'object', properties: { expression: { type: 'string', minLength: 1, maxLength: 50000 } }, required: ['expression'], additionalProperties: false },
    validate(input) { const value = shape(input, ['expression']); return { expression: text(value.expression, 'expression', { maximum: 50_000 }) }; }
  })
};

export const jetTools = Object.freeze({
  snapshot: options => aliased(definitions.snapshot, options),
  navigate: options => aliased(definitions.navigate, options),
  click: options => aliased(definitions.click, options),
  drag: options => aliased(definitions.drag, options),
  type: options => aliased(definitions.type, options),
  press: options => aliased(definitions.press, options),
  scroll: options => aliased(definitions.scroll, options),
  listTabs: options => aliased(definitions.listTabs, options),
  newTab: options => aliased(definitions.newTab, options),
  switchTab: options => aliased(definitions.switchTab, options),
  closeTab: options => aliased(definitions.closeTab, options),
  evaluate: options => aliased(definitions.evaluate, options)
});

const browserToolset = () => [
  jetTools.snapshot(), jetTools.navigate(), jetTools.click(), jetTools.type(), jetTools.press(), jetTools.scroll(),
  jetTools.listTabs(), jetTools.newTab(), jetTools.switchTab(), jetTools.closeTab()
];

export const jetToolsets = Object.freeze({
  browser: browserToolset,
  full: () => [...browserToolset(), jetTools.drag(), jetTools.evaluate()]
});

/** Purely compile declarations. No browser or network resource is created here. */
export function compileToolCatalog(specifications, { namespace = '' } = {}) {
  if (!Array.isArray(specifications) || specifications.length === 0) throw Error('Tool catalog must be non-empty');
  if (namespace && !namePattern.test(namespace)) throw Error('Tool namespace must be a portable identifier');
  const identities = new Set(), names = new Set(), catalog = [];
  for (const value of specifications) {
    if (!value || typeof value.identity !== 'string' || typeof value.name !== 'string' || typeof value.validate !== 'function') throw Error('Invalid tool specification');
    if (identities.has(value.identity)) throw Error(`Duplicate tool identity: ${value.identity}`);
    const name = namespace ? `${namespace}_${value.name}` : value.name;
    if (!namePattern.test(name)) throw Error(`Invalid compiled tool name: ${name}`);
    if (names.has(name)) throw Error(`Duplicate tool name: ${name}`);
    identities.add(value.identity); names.add(name);
    catalog.push(deepFreeze({ ...value, name }));
  }
  return Object.freeze(catalog);
}

function actionSignal(value) {
  if (!value) return null;
  if (typeof value.aborted === 'boolean') return value;
  if (typeof value.signal?.aborted === 'boolean') return value.signal;
  return null;
}

async function invoke(client, sessionId, tool, input, signal) {
  const value = tool.validate(input);
  const options = signal ? { signal } : undefined;
  if (tool.operation === 'snapshot') return client.snapshot(sessionId, options);
  if (tool.operation === 'navigate') return client.navigate(sessionId, value.url, options);
  if (tool.operation === 'click') return client.click(sessionId, value.x, value.y, options);
  if (tool.operation === 'drag') return client.drag(sessionId, value.x, value.y, value.to_x, value.to_y, options);
  if (tool.operation === 'type') return client.type(sessionId, value.text, options);
  if (tool.operation === 'press') return client.press(sessionId, value.key, options);
  if (tool.operation === 'scroll') return client.scroll(sessionId, value.delta, options);
  if (tool.operation === 'tabs') return client.tabs(sessionId, options);
  if (tool.operation === 'newTab') return client.newTab(sessionId, options);
  if (tool.operation === 'switchTab') return client.switchTab(sessionId, value.handle, options);
  if (tool.operation === 'closeTab') return client.closeTab(sessionId, value.handle, options);
  if (tool.operation === 'evaluate') return client.evaluate(sessionId, value.expression, options);
  throw Error(`Unsupported tool operation: ${tool.operation}`);
}

/** Bind one compiled catalog to one existing browser resource. */
export function bindToolCatalog(catalog, { client, sessionId } = {}) {
  if (!Array.isArray(catalog) || Object.isFrozen(catalog) === false) throw Error('Compile the tool catalog before binding');
  if (!client || typeof client !== 'object') throw Error('client is required');
  if (typeof sessionId !== 'string' || !sessionId) throw Error('sessionId is required');
  return Object.freeze(catalog.map(tool => Object.freeze({
    identity: tool.identity,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    mutates: tool.mutates,
    async execute(input = {}, context) {
      const signal = actionSignal(context);
      if (signal?.aborted) throw signal.reason || Error('Tool execution aborted');
      return invoke(client, sessionId, tool, input, signal);
    }
  })));
}
