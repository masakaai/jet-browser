import test from 'node:test';
import assert from 'node:assert/strict';
import { dragInputEvents } from '../src/drag-input.mjs';

test('drag compiles to one bounded pointer sequence with visible intermediate motion', () => {
  const events = dragInputEvents({ x: 100, y: 120, to_x: 700, to_y: 620 });
  assert.deepEqual(events[0], { type: 'pointer', phase: 'move', x: 100, y: 120, button: 0 });
  assert.deepEqual(events[1], { type: 'pointer', phase: 'down', x: 100, y: 120, button: 0 });
  assert.deepEqual(events.at(-1), { type: 'pointer', phase: 'up', x: 700, y: 620, button: 0 });
  assert.ok(events.length >= 6 && events.length <= 12);
  assert.ok(events.slice(2, -1).every((event) => event.phase === 'move' && event.button === 0));
});

test('drag rejects coordinates outside the fixed remote viewport', () => {
  assert.throws(() => dragInputEvents({ x: -1, y: 0, to_x: 1, to_y: 1 }), /viewport/);
  assert.throws(() => dragInputEvents({ x: 1, y: 1, to_x: 1280, to_y: 1 }), /viewport/);
});
