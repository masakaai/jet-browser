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
  const labelWidth = 132;
  const valueWidth = 68;
  const plotX = x + labelWidth;
  const plotWidth = width - labelWidth - valueWidth;
  const barHeight = 28;
  const rowGap = 20;
  const plotTop = y + 72;
  const maximum = niceMaximum(Math.max(...values.map(item => item.value)) * 1.08);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction, index) => {
    const gx = Math.round(plotX + plotWidth * fraction);
    const label = Math.round(maximum * fraction);
    return `<line x1="${gx}" y1="${plotTop - 20}" x2="${gx}" y2="${y + height - 44}" stroke="${index ? '#cbc4c0' : '#292523'}" stroke-width="${index ? '0.8' : '1'}"${index ? ' stroke-dasharray="4 4"' : ''}/><text x="${gx}" y="${y + height - 20}" fill="#726a65" font-size="12" font-family="'Space Mono', monospace" text-anchor="middle">${label}</text>`;
  }).join('');
  const bars = values.map((item, index) => {
    const rowY = plotTop + index * (barHeight + rowGap);
    const barWidth = Math.max(4, Math.round((item.value / maximum) * plotWidth));
    const focal = item.name === 'jet';
    return `<text x="${plotX - 16}" y="${rowY + 19}" fill="#292523" font-size="16" font-weight="600" font-family="'DM Sans', Arial, sans-serif" text-anchor="end">${esc(labels[item.name] || item.name)}</text><rect x="${plotX}" y="${rowY}" width="${barWidth}" height="${barHeight}" fill="${focal ? '#eeb28a' : '#ded7d1'}" stroke="${focal ? '#292523' : '#726a65'}" stroke-width="1"/><text x="${x + width - 8}" y="${rowY + 19}" fill="${focal ? '#292523' : '#726a65'}" font-size="13" font-weight="600" font-family="'Space Mono', monospace" text-anchor="end">${esc(item.value)} ${unit}</text>`;
  }).join('');
  return `<g><text x="${x}" y="${y + 24}" fill="#292523" font-size="24" font-weight="600" font-family="'DM Sans', Arial, sans-serif">${esc(title)}</text><text x="${x}" y="${y + 48}" fill="#726a65" font-size="12" font-family="'Space Mono', monospace">MEDIAN · LOWER IS BETTER</text>${grid}${bars}</g>`;
}

export function renderBenchmarkSvg(summary) {
  const entries = Object.entries(summary.implementations);
  for (const [name, value] of entries) {
    if (value.requested !== summary.method.runs || value.passed !== value.requested) {
      throw Error(`${name} cannot be charted without a complete passing sample set`);
    }
  }
  const ready = entries.map(([name, value]) => ({ name, value: value.browserReadyMs.median }));
  const memory = entries.map(([name, value]) => ({ name, value: value.activeMemoryMiB.median }));
  const date = String(summary.capturedAt || '').slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 640" role="img" aria-labelledby="jet-runtime-benchmark-title jet-runtime-benchmark-desc">
  <title id="jet-runtime-benchmark-title">Jet Browser reproducible runtime benchmark</title>
  <desc id="jet-runtime-benchmark-desc">Horizontal bar charts compare median time to a verified browser page and median active container memory for Jet Browser and pinned self-hosted browser implementations. Lower is better.</desc>
  <rect width="1200" height="640" fill="#f2f1e9"/>
  <text x="48" y="56" fill="#726a65" font-size="12" font-family="'Space Mono', monospace" letter-spacing="2">JET BROWSER · RUNTIME REPORT</text>
  <text x="48" y="104" fill="#292523" font-size="40" font-weight="600" font-family="'DM Sans', Arial, sans-serif">Measured on the same host.</text>
  <text x="48" y="136" fill="#726a65" font-size="16" font-family="'DM Sans', Arial, sans-serif">Offline fixture · 2 CPU · 1 GiB · ${esc(date)} · Lower is better</text>
  <line x1="48" y1="160" x2="1152" y2="160" stroke="#292523" stroke-width="1"/>
  ${panel({ title: 'Browser ready', unit: 'ms', values: ready, x: 48, y: 184, width: 536, height: 360 })}
  ${panel({ title: 'Active memory', unit: 'MiB', values: memory, x: 616, y: 184, width: 536, height: 360 })}
  <line x1="48" y1="568" x2="1152" y2="568" stroke="#cbc4c0" stroke-width="1"/>
  <rect x="48" y="592" width="16" height="16" fill="#eeb28a" stroke="#292523"/><text x="76" y="605" fill="#292523" font-size="13" font-family="'DM Sans', Arial, sans-serif">Jet Browser</text>
  <rect x="216" y="592" width="16" height="16" fill="#ded7d1" stroke="#726a65"/><text x="244" y="605" fill="#726a65" font-size="13" font-family="'DM Sans', Arial, sans-serif">Pinned upstream runtime</text>
  <text x="1152" y="605" fill="#726a65" font-size="11" font-family="'Space Mono', monospace" text-anchor="end">RAW JSON + METHOD IN /benchmarks</text>
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
