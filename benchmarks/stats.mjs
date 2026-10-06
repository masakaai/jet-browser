export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw Error('Percentile fraction must be between 0 and 1');
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

export function summarize(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length === 0) return null;
  const total = clean.reduce((sum, value) => sum + value, 0);
  return {
    count: clean.length,
    min: Math.min(...clean),
    median: percentile(clean, 0.5),
    p95: percentile(clean, 0.95),
    max: Math.max(...clean),
    mean: Math.round(total / clean.length)
  };
}

export function summarizeSamples(samples) {
  const passed = samples.filter(sample => sample.status === 'passed');
  return {
    requested: samples.length,
    passed: passed.length,
    failed: samples.length - passed.length,
    successRate: samples.length ? Number((passed.length / samples.length).toFixed(4)) : 0,
    targetReadyMs: summarize(passed.map(sample => sample.targetReadyMs)),
    scriptRoundTripMs: summarize(passed.map(sample => sample.scriptRoundTripMs)),
    stopMs: summarize(samples.map(sample => sample.stopMs))
  };
}
