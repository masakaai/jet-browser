const modifiers = new Map([
  ['Control', 'Control'],
  ['ControlOrMeta', 'Control'],
  ['Shift', 'Shift'],
  ['Alt', 'Alt'],
  ['Meta', 'Meta'],
]);

export function keyEvents(value) {
  const parts = String(value).split('+');
  if (!parts.length || parts.some((part) => !part)) throw Error('Unsupported key chord');
  const key = parts.pop();
  const held = parts.map((part) => {
    const modifier = modifiers.get(part);
    if (!modifier) throw Error('Unsupported key chord');
    return modifier;
  });
  if (new Set(held).size !== held.length) throw Error('Unsupported key chord');
  return [
    ...held.map((modifier) => ({ type: 'key', key: modifier, down: true })),
    { type: 'key', key, down: true },
    { type: 'key', key, down: false },
    ...held.reverse().map((modifier) => ({ type: 'key', key: modifier, down: false })),
  ];
}
