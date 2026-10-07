import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { summarizeRuntimeReport } from './runtime-report.mjs';

const labels = {
  jet: 'Jet Browser',
  'browser-use': 'Browser Use',
  'steel-browser': 'Steel Browser',
  browserless: 'Browserless',
};

const esc = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);

const niceMaximum = value => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
};

function panel({ title, unit, values, x, y, width, height }) {
  const padding = 30;
  const labelWidth = 142;
  const valueWidth = 92;
  const plotX = x + padding + labelWidth;
  const plotWidth = width - padding * 2 - labelWidth - valueWidth;
  const barHeight = 14;
  const rowGap = 58;
  const plotTop = y + 82;
  const maximum = niceMaximum(Math.max(...values.map(item => item.value)) * 1.08);
  const jet = values.find(item => item.name === 'jet');
  const alternative = values.filter(item => item.name !== 'jet').sort((left, right) => left.value - right.value)[0];
  const difference = jet && alternative ? Math.round(Math.abs(1 - jet.value / alternative.value) * 100) : null;
  const claim = difference === null ? 'p50' : `${jet.value <= alternative.value ? '−' : '+'}${difference}%`;
  const bars = values.map((item, index) => {
    const rowY = plotTop + index * rowGap;
    const barWidth = Math.max(10, Math.round((item.value / maximum) * plotWidth));
    const focal = item.name === 'jet';
    return `<text x="${x + padding}" y="${rowY + 12}" fill="${focal ? '#111111' : '#66686d'}" font-size="15" font-weight="${focal ? '700' : '600'}" font-family="Arial, Helvetica, sans-serif">${esc(labels[item.name] || item.name)}</text><rect x="${plotX}" y="${rowY}" width="${plotWidth}" height="${barHeight}" rx="7" fill="#e5e7eb"/><rect x="${plotX}" y="${rowY}" width="${barWidth}" height="${barHeight}" rx="7" fill="${focal ? '#f97316' : '#c9cdd3'}"/><text x="${x + width - padding}" y="${rowY + 12}" fill="${focal ? '#f97316' : '#66686d'}" font-size="13" font-weight="700" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="end">${esc(item.value)} ${unit}</text>`;
  }).join('');
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#f8f8f9" stroke="#e2e4e8"/><text x="${x + padding}" y="${y + 43}" fill="#111111" font-size="23" font-weight="700" font-family="Arial, Helvetica, sans-serif">${esc(title)}</text><text x="${x + width - padding}" y="${y + 43}" fill="#f97316" font-size="18" font-weight="700" font-family="Arial, Helvetica, sans-serif" text-anchor="end">${esc(claim)}</text>${bars}<text x="${x + padding}" y="${y + height - 22}" fill="#777a80" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">p50 · ${esc(values[0]?.passed || 0)}/${esc(values[0]?.requested || 0)} passed</text></g>`;
}

export function renderBenchmarkSvg(summary) {
  const entries = Object.entries(summary.implementations);
  for (const [name, value] of entries) {
    if (value.requested !== summary.method.runs || value.passed !== value.requested) {
      throw Error(`${name} cannot be charted without a complete passing sample set`);
    }
  }
  const ready = entries.map(([name, value]) => ({ name, value: value.browserReadyMs.median, passed: value.passed, requested: value.requested }));
  const memory = entries.map(([name, value]) => ({ name, value: value.activeMemoryMiB.median, passed: value.passed, requested: value.requested }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 540" role="img" aria-labelledby="jet-runtime-benchmark-title jet-runtime-benchmark-desc">
  <title id="jet-runtime-benchmark-title">Jet Browser runtime benchmark</title>
  <desc id="jet-runtime-benchmark-desc">Median browser-ready time and active memory across complete passing sample sets. Lower is better.</desc>
  <rect width="1200" height="540" fill="#ffffff"/>
  <text x="48" y="55" fill="#111111" font-size="34" font-weight="700" font-family="Arial, Helvetica, sans-serif">Jet Browser runtime benchmark</text>
  <text x="48" y="91" fill="#66686d" font-size="16" font-family="Arial, Helvetica, sans-serif">Median of ${esc(summary.method.runs)} runs · same Linux host · lower is better</text>
  <rect x="48" y="122" width="18" height="12" rx="6" fill="#f97316"/><text x="78" y="133" fill="#333438" font-size="13" font-weight="700" font-family="Arial, Helvetica, sans-serif">Jet Browser</text>
  <rect x="196" y="122" width="18" height="12" rx="6" fill="#c9cdd3"/><text x="226" y="133" fill="#66686d" font-size="13" font-family="Arial, Helvetica, sans-serif">Other runtimes</text>
  ${panel({ title: 'Browser ready', unit: 'ms', values: ready, x: 48, y: 158, width: 536, height: 342 })}
  ${panel({ title: 'Active memory', unit: 'MiB', values: memory, x: 616, y: 158, width: 536, height: 342 })}
</svg>`;
}

export function renderBenchmarkHtml(summary) {
  const svg = renderBenchmarkSvg(summary).replace(/^<\?xml[^>]*>\s*/, '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Jet Browser runtime benchmark</title>
  <style>
    :root { color-scheme: light; background:#f3f4f6; }
    * { box-sizing:border-box; }
    body { min-height:100vh; display:grid; place-items:center; margin:0; padding:24px; background:#f3f4f6; }
    main { width:min(1200px,100%); }
    svg { display:block; width:100%; height:auto; border:1px solid #e2e4e8; }
  </style>
</head>
<body><main>${svg}</main></body>
</html>`;
}

async function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) throw Error('Usage: node benchmarks/render-chart.mjs report.json chart.svg');
  const report = JSON.parse(await readFile(input, 'utf8'));
  const summary = summarizeRuntimeReport(report);
  const rendered = output.endsWith('.html') ? renderBenchmarkHtml(summary) : renderBenchmarkSvg(summary);
  await writeFile(output, rendered + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
