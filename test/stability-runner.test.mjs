import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStabilityBenchmark } from '../scripts/stability-runner.mjs';
import { validateStabilityReport } from '../scripts/stability-report.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function createFakeDocker(directory) {
  const docker = join(directory, 'fake-docker.mjs');
  await writeFile(docker, `#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.FAKE_STABILITY_MODE || 'success';
if (args[0] === 'image' && args[1] === 'inspect') {
  process.stdout.write('sha256:${'0'.repeat(64)}\\n');
} else if (args[0] === 'version') {
  process.stdout.write('29.0.0\\n');
} else if (args[0] === 'stats') {
  process.stdout.write('201.5MiB / 1GiB\\n');
} else if (args[0] === 'top') {
  const driver = mode === 'driver-exit' ? '' : '13 /usr/bin/WPEWebDriver --port=9515\\n';
  process.stdout.write('PID COMMAND\\n12 /usr/local/bin/jet-browser-supervisor\\n' + driver + '14 /usr/local/bin/jet-browser-minibrowser --automation\\n');
} else if (args[0] === 'rm') {
  process.exit(0);
} else if (args[0] === 'inspect') {
  process.stderr.write('Error: No such object\\n');
  process.exit(1);
} else if (args[0] === 'run') {
  const pages = new Map([['primary', {url:'about:blank', marker:'', input:''}]]);
  let current = 'primary';
  let nextHandle = 2;
  let buffer = '';
  const respond = value => process.stdout.write(JSON.stringify({ok:true,value})+'\\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\\n');
      if (newline < 0) break;
      const command = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const page = pages.get(current);
      if (command.op === 'create') respond({sessionId:'fake'});
      else if (command.op === 'current_window') respond(current);
      else if (command.op === 'new_window') {
        current = 'page-' + nextHandle++;
        pages.set(current, {url:'about:blank', marker:'', input:''});
        respond({handle:current,type:'tab'});
      } else if (command.op === 'switch_window') {
        if (!pages.has(command.handle)) throw Error('unknown fake handle');
        current = command.handle;
        respond({});
      } else if (command.op === 'navigate') {
        const active = pages.get(current);
        active.url = command.url;
        active.marker = new URL(command.url).searchParams.get('marker');
        respond({});
      } else if (command.op === 'document_state') {
        const active = pages.get(current);
        respond({url:active.url,readyState:'complete'});
      } else if (command.op === 'input') {
        const active = pages.get(current);
        active.input = command.events.find(event => event.type === 'text')?.text || '';
        respond({applied:command.events.length});
      } else if (command.op === 'evaluate') {
        const active = pages.get(current);
        respond({result:{value:command.expression.includes('setItem')
          ? {input:active.input,result:active.input,marker:active.marker,script:active.marker,stored:active.marker}
          : {stored:active.marker,script:active.marker,marker:active.marker}}});
      } else if (command.op === 'snapshot') {
        const active = pages.get(current);
        respond({url:active.url,title:'Jet Browser Ready',text:active.marker});
      } else if (command.op === 'screenshot') {
        const active = pages.get(current);
        respond(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(active.marker),Buffer.alloc(1100)]).toString('base64'));
      } else if (command.op === 'window_handles') respond([...pages.keys()]);
      else if (command.op === 'close_window') {
        pages.delete(current);
        current = 'primary';
        respond([...pages.keys()]);
      } else if (command.op === 'close') {
        respond(null);
        setTimeout(() => process.exit(0), 5);
      } else respond({});
    }
  });
} else process.exit(2);
`, { mode: 0o755 });
  await chmod(docker, 0o755);
  return docker;
}

function options(directory, docker, mode, output) {
  return {
    durationSeconds: 5,
    pageCount: 2,
    churnCycles: 1,
    sampleIntervalMs: 60_000,
    output,
    image: 'jet-browser:test',
    noBuild: true,
    root: repositoryRoot,
    docker,
    environment: { ...process.env, FAKE_STABILITY_MODE: mode },
    containerName: `jet-browser-stability-${mode}-test`,
  };
}

test('stability runner preserves ordered page and cleanup evidence', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-stability-'));
  const docker = await createFakeDocker(directory);
  const output = join(directory, 'success.json');
  try {
    const result = await runStabilityBenchmark(options(directory, docker, 'success', output));
    assert.equal(result.outputPath, output);
    assert.equal(result.report.status, 'passed');
    assert.equal(result.report.samples.cycles.length, 1);
    assert.equal(result.report.samples.cycles[0].pages.length, 2);
    assert.notEqual(
      result.report.samples.cycles[0].pages[0].screenshotSha256,
      result.report.samples.cycles[0].pages[1].screenshotSha256,
    );
    assert.ok(result.report.samples.resources.some(sample => sample.phase === 'page-cleanup'));
    assert.deepEqual(result.report.cleanup, {
      extraPagesClosed: true,
      sessionClosed: true,
      containerRemoved: true,
    });
    const persisted = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(validateStabilityReport(persisted).status, 'passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stability runner preserves a distinct process-exit failure report', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-stability-'));
  const docker = await createFakeDocker(directory);
  const output = join(directory, 'failed.json');
  try {
    await assert.rejects(
      runStabilityBenchmark(options(directory, docker, 'driver-exit', output)),
      /stability benchmark failed/,
    );
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(validateStabilityReport(report).status, 'failed');
    assert.ok(report.failures.some(failure => failure.roles?.driver === false));
    assert.ok(report.samples.resources.some(sample => sample.roles.driver === false));
    assert.equal(report.cleanup.sessionClosed, true);
    assert.equal(report.cleanup.containerRemoved, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
