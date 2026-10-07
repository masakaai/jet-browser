import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeRuntimeReport, validateRuntimeReport } from '../benchmarks/runtime-report.mjs';
import { renderBenchmarkHtml, renderBenchmarkSvg } from '../benchmarks/render-chart.mjs';

const fixture = {
  schemaVersion: 1,
  capturedAt: '2026-10-07T00:00:00.000Z',
  method: {
    runs: 3,
    warmups: 1,
    concurrency: 1,
    task: 'offline-fixture-title-and-dom-verification',
  },
  system: { os: 'linux', architecture: 'x64', cpuLimit: 2, memoryLimitMiB: 1024 },
  implementations: {
    jet: {
      commit: 'a'.repeat(40),
      license: 'Apache-2.0',
      samples: [
        { status: 'passed', browserReadyMs: 100, scriptVerified: true, activeMemoryMiB: 100 },
        { status: 'passed', browserReadyMs: 120, scriptVerified: true, activeMemoryMiB: 110 },
        { status: 'passed', browserReadyMs: 110, scriptVerified: true, activeMemoryMiB: 105 },
      ],
    },
    browserless: {
      commit: 'b'.repeat(40),
      license: 'SSPL-1.0',
      samples: [
        { status: 'passed', browserReadyMs: 300, scriptVerified: true, activeMemoryMiB: 400 },
        { status: 'passed', browserReadyMs: 320, scriptVerified: true, activeMemoryMiB: 420 },
        { status: 'passed', browserReadyMs: 310, scriptVerified: true, activeMemoryMiB: 410 },
      ],
    },
  },
};

test('runtime report rejects missing or failed implementation samples', () => {
  assert.doesNotThrow(() => validateRuntimeReport(fixture));
  assert.throws(() => validateRuntimeReport({ ...fixture, implementations: {} }), /implementation/i);
  assert.throws(() => validateRuntimeReport({
    ...fixture,
    implementations: {
      jet: { ...fixture.implementations.jet, samples: Array.from({ length: 3 }, () => ({ status: 'failed' })) },
    },
  }), /passed sample/i);
  assert.throws(() => validateRuntimeReport({
    ...fixture,
    implementations: {
      jet: { ...fixture.implementations.jet, samples: fixture.implementations.jet.samples.slice(0, 2) },
    },
  }), /requested number/i);
});

test('runtime summaries use passed samples and preserve lower-is-better metrics', () => {
  const summary = summarizeRuntimeReport(fixture);
  assert.equal(summary.implementations.jet.browserReadyMs.median, 110);
  assert.equal(summary.implementations.jet.activeMemoryMiB.median, 105);
  assert.equal(summary.implementations.jet.successRate, 1);
});

test('README chart is accessible, branded, and generated from measured data', () => {
  const svg = renderBenchmarkSvg(summarizeRuntimeReport(fixture));
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-labelledby="jet-runtime-benchmark-title jet-runtime-benchmark-desc"/);
  assert.match(svg, /<title id="jet-runtime-benchmark-title">/);
  assert.match(svg, /Lower is better/);
  assert.match(svg, /#eeb28a/i);
  assert.match(svg, />110 ms</);
  assert.match(svg, />105 MiB</);
  assert.doesNotMatch(svg, /JetBrains Mono/i);
  const html = renderBenchmarkHtml(summarizeRuntimeReport(fixture));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<svg[^>]+role="img"/);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  const partial = summarizeRuntimeReport({
    ...fixture,
    implementations: {
      jet: {
        ...fixture.implementations.jet,
        samples: [fixture.implementations.jet.samples[0], fixture.implementations.jet.samples[1], { status: 'failed' }],
      },
    },
  });
  assert.throws(() => renderBenchmarkSvg(partial), /complete passing sample set/);
});

test('published report has seven verified samples and Jet leads both scoped metrics', () => {
  const report = JSON.parse(readFileSync(new URL('../benchmarks/results/runtime-2026-10-07.json', import.meta.url)));
  const summary = summarizeRuntimeReport(report);
  for (const implementation of Object.values(summary.implementations)) {
    assert.equal(implementation.requested, 7);
    assert.equal(implementation.passed, 7);
    assert.equal(implementation.successRate, 1);
  }
  const jet = summary.implementations.jet;
  for (const [name, implementation] of Object.entries(summary.implementations)) {
    if (name === 'jet') continue;
    assert.ok(jet.browserReadyMs.median < implementation.browserReadyMs.median);
    assert.ok(jet.activeMemoryMiB.median < implementation.activeMemoryMiB.median);
  }
  assert.equal(jet.browserReadyMs.median, 1445.25);
  assert.equal(jet.activeMemoryMiB.median, 189.6);
});

test('competitor manifest pins source commits and states benchmark inclusion', () => {
  const manifest = JSON.parse(readFileSync(new URL('../benchmarks/competitors.lock.json', import.meta.url)));
  for (const name of ['browser-use', 'stagehand', 'steel-browser', 'browserless']) {
    const entry = manifest.implementations[name];
    assert.match(entry.repository, /^https:\/\/github\.com\//);
    assert.match(entry.commit, /^[a-f0-9]{40}$/);
    assert.equal(typeof entry.benchmark, 'boolean');
    assert.ok(entry.license);
  }
  assert.equal(manifest.implementations.stagehand.benchmark, false);
  assert.match(manifest.implementations.stagehand.exclusion, /LLM|hosted|extension/i);
});
