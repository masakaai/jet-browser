import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStandaloneSmoke } from '../scripts/standalone-runner.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function createFakeDocker(directory) {
  const docker = join(directory, 'fake-docker.mjs');
  await writeFile(docker, `#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const log = process.env.FAKE_DOCKER_LOG;
const mode = process.env.FAKE_DOCKER_MODE;
const args = process.argv.slice(2);
appendFileSync(log, JSON.stringify({args,pid:process.pid})+'\\n');
if (args[0] === 'run' && mode === 'cancel') {
  const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {stdio:['ignore','inherit','inherit']});
  appendFileSync(log, JSON.stringify({descendant:descendant.pid})+'\\n');
  process.on('SIGTERM', () => {
    appendFileSync(log, JSON.stringify({signal:'SIGTERM',pid:process.pid})+'\\n');
    process.exit(143);
  });
  appendFileSync(log, JSON.stringify({ready:true,pid:process.pid})+'\\n');
  process.stdin.resume();
  setInterval(() => {}, 1000);
} else if (args[0] === 'run' && mode === 'exit-readiness') {
  let operations = 0;
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\\n');
      if (newline < 0) break;
      buffer = buffer.slice(newline + 1);
      operations += 1;
      if (operations === 3) process.exit(7);
      process.stdout.write(JSON.stringify({ok:true,value:{}})+'\\n');
    }
  });
} else if (args[0] === 'run' && mode === 'success') {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\\n');
      if (newline < 0) break;
      const command = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      let value = {};
      if (command.op === 'document_state') value = {url:'http://127.0.0.1:8080/',readyState:'complete'};
      if (command.op === 'snapshot') value = {url:'http://127.0.0.1:8080/',title:'Jet Browser Ready'};
      if (command.op === 'evaluate') value = {result:{value:{value:'open-source runtime',result:'open-source runtime'}}};
      if (command.op === 'screenshot') value = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(1100)]).toString('base64');
      process.stdout.write(JSON.stringify({ok:true,value})+'\\n');
      if (command.op === 'close') setTimeout(() => process.exit(0), 10);
    }
  });
} else if (args[0] === 'run') {
  process.exit(7);
} else if (args[0] === 'rm' && mode === 'cleanup-stall') {
  process.on('SIGTERM', () => appendFileSync(log, JSON.stringify({signal:'SIGTERM',pid:process.pid})+'\\n'));
  setInterval(() => {}, 1000);
}
`, { mode: 0o755 });
  await chmod(docker, 0o755);
  return docker;
}

async function waitForText(path, pattern) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      const text = await readFile(path, 'utf8');
      if (pattern.test(text)) return text;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for ${pattern}`);
}

test('standalone cancellation terminates Docker and removes its named container', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-runner-'));
  const docker = join(directory, 'fake-docker.mjs');
  const log = join(directory, 'docker.log');
  const containerName = 'jet-browser-smoke-cancellation-test';
  await createFakeDocker(directory);

  const controller = new AbortController();
  try {
    const verification = runStandaloneSmoke({
      root: repositoryRoot,
      image: 'example.invalid/jet-browser@sha256:test',
      docker,
      noBuild: true,
      signal: controller.signal,
      environment: { ...process.env, FAKE_DOCKER_LOG: log, FAKE_DOCKER_MODE: 'cancel' },
      containerName,
      terminationGraceMs: 100,
    });
    const initialLog = await waitForText(log, /"ready":true/);
    const runRecord = initialLog.trim().split('\n').map(JSON.parse).find(record => record.args[0] === 'run');
    controller.abort();
    await assert.rejects(verification, error => error.name === 'AbortError');

    const finalLog = await waitForText(log, /"rm","-f","jet-browser-smoke-cancellation-test"/);
    const records = finalLog.trim().split('\n').map(JSON.parse);
    const descendantRecord = records.find(record => record.descendant);
    assert.ok(records.some(record => record.signal === 'SIGTERM' && record.pid === runRecord.pid));
    assert.ok(records.some(record => JSON.stringify(record.args) === JSON.stringify(['rm', '-f', containerName])));
    assert.throws(() => process.kill(runRecord.pid, 0), error => error.code === 'ESRCH');
    assert.throws(() => process.kill(descendantRecord.descendant, 0), error => error.code === 'ESRCH');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('standalone runner preserves the complete native-input and PNG evidence flow', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-runner-'));
  const docker = await createFakeDocker(directory);
  const log = join(directory, 'docker.log');
  try {
    const result = await runStandaloneSmoke({
      root: repositoryRoot,
      image: 'example.invalid/jet-browser@sha256:test',
      docker,
      noBuild: true,
      environment: { ...process.env, FAKE_DOCKER_LOG: log, FAKE_DOCKER_MODE: 'success' },
      containerName: 'jet-browser-smoke-success-test',
      terminationGraceMs: 50,
      cleanupTimeoutMs: 500,
    });
    assert.deepEqual(result, {
      status: 'passed',
      network: 'disabled',
      title: 'Jet Browser Ready',
      input: 'open-source runtime',
      screenshotBytes: 1108,
    });
    await waitForText(log, /"rm","-f","jet-browser-smoke-success-test"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('early Docker exit is observed before cleanup without an unhandled rejection', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-runner-'));
  const docker = await createFakeDocker(directory);
  const log = join(directory, 'docker.log');
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const started = Date.now();
  try {
    await assert.rejects(runStandaloneSmoke({
      root: repositoryRoot,
      image: 'example.invalid/jet-browser@sha256:test',
      docker,
      noBuild: true,
      environment: { ...process.env, FAKE_DOCKER_LOG: log, FAKE_DOCKER_MODE: 'exit-readiness' },
      containerName: 'jet-browser-smoke-exit-test',
      terminationGraceMs: 50,
    }), /exited before responding/);
    assert.ok(Date.now() - started < 2_000);
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    assert.deepEqual(unhandled, []);
    await waitForText(log, /"rm","-f","jet-browser-smoke-exit-test"/);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await rm(directory, { recursive: true, force: true });
  }
});

test('stalled container cleanup is forcibly killed and cannot hold the caller', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jet-browser-runner-'));
  const docker = await createFakeDocker(directory);
  const log = join(directory, 'docker.log');
  const started = Date.now();
  try {
    await assert.rejects(runStandaloneSmoke({
      root: repositoryRoot,
      image: 'example.invalid/jet-browser@sha256:test',
      docker,
      noBuild: true,
      environment: { ...process.env, FAKE_DOCKER_LOG: log, FAKE_DOCKER_MODE: 'cleanup-stall' },
      containerName: 'jet-browser-smoke-cleanup-test',
      terminationGraceMs: 50,
      cleanupTimeoutMs: 500,
    }), /container cleanup failed/);
    assert.ok(Date.now() - started < 2_000);

    const text = await waitForText(log, /"rm","-f","jet-browser-smoke-cleanup-test"/);
    const records = text.trim().split('\n').map(JSON.parse);
    const cleanupRecord = records.find(record => record.args[0] === 'rm');
    assert.ok(records.some(record => record.signal === 'SIGTERM' && record.pid === cleanupRecord.pid));
    assert.throws(() => process.kill(cleanupRecord.pid, 0), error => error.code === 'ESRCH');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
