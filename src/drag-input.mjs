const coordinate = (value) => Number.isFinite(value) ? Math.round(value) : NaN;

export function dragInputEvents({ x, y, to_x: toX, to_y: toY }, { steps = 7 } = {}) {
  const startX = coordinate(x), startY = coordinate(y), endX = coordinate(toX), endY = coordinate(toY);
  if (![startX, startY, endX, endY].every(Number.isFinite)
    || startX < 0 || startX > 1279 || endX < 0 || endX > 1279
    || startY < 0 || startY > 799 || endY < 0 || endY > 799) {
    throw new Error('Drag coordinates outside browser viewport');
  }
  const count = Math.max(3, Math.min(9, Math.floor(Number(steps) || 7)));
  const events = [
    { type: 'pointer', phase: 'move', x: startX, y: startY, button: 0 },
    { type: 'pointer', phase: 'down', x: startX, y: startY, button: 0 },
  ];
  for (let step = 1; step <= count; step++) {
    events.push({
      type: 'pointer', phase: 'move',
      x: Math.round(startX + (endX - startX) * step / count),
      y: Math.round(startY + (endY - startY) * step / count), button: 0,
    });
  }
  events.push({ type: 'pointer', phase: 'up', x: endX, y: endY, button: 0 });
  return events;
}
