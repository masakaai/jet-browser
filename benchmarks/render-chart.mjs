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
  const padding = 32;
  const plotX = x + padding;
  const plotWidth = width - padding * 2;
  const barHeight = 18;
  const rowGap = 70;
  const plotTop = y + 112;
  const maximum = niceMaximum(Math.max(...values.map(item => item.value)) * 1.08);
  const jet = values.find(item => item.name === 'jet');
  const alternative = values.filter(item => item.name !== 'jet').sort((left, right) => left.value - right.value)[0];
  const difference = jet && alternative ? Math.round(Math.abs(1 - jet.value / alternative.value) * 100) : null;
  const claim = difference === null ? 'Measured p50' : `${difference}% ${jet.value <= alternative.value ? 'lower' : 'higher'}`;
  const comparison = alternative ? `vs ${labels[alternative.name] || alternative.name}` : 'verified samples';
  const bars = values.map((item, index) => {
    const rowY = plotTop + index * rowGap;
    const barWidth = Math.max(10, Math.round((item.value / maximum) * plotWidth));
    const focal = item.name === 'jet';
    return `<text x="${plotX}" y="${rowY + 17}" fill="${focal ? '#292523' : '#625d59'}" font-size="15" font-weight="${focal ? '700' : '600'}" font-family="'DM Sans', Arial, sans-serif">${esc(labels[item.name] || item.name)}</text><text x="${x + width - padding}" y="${rowY + 17}" fill="${focal ? '#d85f18' : '#625d59'}" font-size="13" font-weight="700" font-family="'Space Mono', monospace" text-anchor="end">${esc(item.value)} ${unit}</text><rect x="${plotX}" y="${rowY + 30}" width="${plotWidth}" height="${barHeight}" rx="9" fill="#ebe9e3"/><rect x="${plotX}" y="${rowY + 30}" width="${barWidth}" height="${barHeight}" rx="9" fill="${focal ? '#e87532' : '#c8c6c0'}"/>`;
  }).join('');
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#fff" stroke="#d9d6cf"/><text x="${x + padding}" y="${y + 48}" fill="#292523" font-size="25" font-weight="700" font-family="'DM Sans', Arial, sans-serif">${esc(title)}</text><text x="${x + padding}" y="${y + 76}" fill="#726a65" font-size="12" font-family="'Space Mono', monospace">P50 · LOWER IS BETTER</text><rect x="${x + width - 154}" y="${y + 24}" width="122" height="36" rx="9" fill="#fff1e7" stroke="#eeb28a"/><text x="${x + width - 93}" y="${y + 48}" fill="#d85f18" font-size="15" font-weight="700" font-family="'DM Sans', Arial, sans-serif" text-anchor="middle">${esc(claim)}</text><text x="${x + width - padding}" y="${y + 78}" fill="#8a817b" font-size="11" font-family="'DM Sans', Arial, sans-serif" text-anchor="end">${esc(comparison)}</text>${bars}<text x="${x + padding}" y="${y + height - 20}" fill="#726a65" font-size="12" font-family="'Space Mono', monospace">${esc(values[0]?.passed || 0)}/${esc(values[0]?.requested || 0)} PASSED · MEDIAN OF VERIFIED RUNS</text></g>`;
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
  const date = String(summary.capturedAt || '').slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700" role="img" aria-labelledby="jet-runtime-benchmark-title jet-runtime-benchmark-desc">
  <title id="jet-runtime-benchmark-title">Jet Browser reproducible runtime benchmark</title>
  <desc id="jet-runtime-benchmark-desc">Horizontal bar charts compare median time to a verified browser page and median active container memory for Jet Browser and pinned self-hosted browser implementations. Lower is better.</desc>
  <rect width="1200" height="700" fill="#f4f2ec"/>
  <text x="48" y="42" fill="#8a817b" font-size="12" font-family="'Space Mono', monospace" letter-spacing="2">JET BROWSER · REPRODUCIBLE RUNTIME BENCHMARK</text>
  <text x="48" y="88" fill="#292523" font-size="38" font-weight="700" font-family="'DM Sans', Arial, sans-serif">Verified browser runtime, measured end to end.</text>
  <text x="48" y="122" fill="#726a65" font-size="16" font-family="'DM Sans', Arial, sans-serif">Same Linux host · offline fixture · 2 CPU · 1 GiB · ${esc(date)} · lower is better</text>
  ${panel({ title: 'Browser ready', unit: 'ms', values: ready, x: 48, y: 152, width: 536, height: 430 })}
  ${panel({ title: 'Active memory', unit: 'MiB', values: memory, x: 616, y: 152, width: 536, height: 430 })}
  <line x1="48" y1="620" x2="1152" y2="620" stroke="#d9d6cf" stroke-width="1"/>
  <rect x="48" y="648" width="18" height="18" rx="9" fill="#e87532"/><text x="78" y="662" fill="#292523" font-size="13" font-weight="700" font-family="'DM Sans', Arial, sans-serif">Jet Browser</text>
  <rect x="210" y="648" width="18" height="18" rx="9" fill="#c8c6c0"/><text x="240" y="662" fill="#726a65" font-size="13" font-family="'DM Sans', Arial, sans-serif">Pinned upstream runtime</text>
  <text x="1152" y="656" fill="#726a65" font-size="11" font-family="'Space Mono', monospace" text-anchor="end">7 RUNS EACH · RAW JSON + SOURCE LOCK IN /BENCHMARKS</text>
  <text x="1152" y="678" fill="#8a817b" font-size="11" font-family="'DM Sans', Arial, sans-serif" text-anchor="end">Cold container start → verified title + DOM + JavaScript + PNG</text>
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
    :root { color-scheme: light; background:#f2f1e9; }
    * { box-sizing:border-box; }
    body { min-height:100vh; display:grid; place-items:center; margin:0; padding:24px; background:#f2f1e9; }
    main { width:min(1200px,100%); }
    svg { display:block; width:100%; height:auto; border:1px solid #cbc4c0; }
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
