import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForFixtureDocument } from './standalone-readiness.mjs';
import {
  parseDockerMemoryMiB,
  processRolesFromDockerTop,
  validateStabilityReport,
} from './stability-report.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

function safeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bwss?:\/\/[^\s"'<>]+/gi, '[redacted-websocket-url]')
    .replace(/([?&](?:jwt|token|ticket)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 500);
}

function signalProcessTree(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error.code !== 'ESRCH') {
        try { child.kill(signal); } catch {}
      }
      return;
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill(signal); } catch {}
  }
}

function runCommand(command, args, {
  cwd = defaultRoot,
  environment = process.env,
  timeoutMs = 30_000,
  maxBuffer = 1024 * 1024,
  inherit = false,
} = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      detached: process.platform !== 'win32',
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let settled = false;
    let forced;
    let hardStop;
    let timer;
    let pendingError;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forced) clearTimeout(forced);
      if (hardStop) clearTimeout(hardStop);
      if (error) reject(error);
      else resolvePromise(result);
    };
    const stop = error => {
      if (pendingError) return;
      pendingError = error;
      signalProcessTree(child, 'SIGTERM');
      forced ??= setTimeout(() => signalProcessTree(child, 'SIGKILL'), 1000);
      hardStop ??= setTimeout(() => finish(pendingError), 2000);
      forced.unref();
      hardStop.unref();
      pendingError.stdout = stdout;
      pendingError.stderr = stderr;
    };
    if (!inherit) {
      const capture = target => chunk => {
        bytes += chunk.length;
        if (bytes > maxBuffer) return stop(Error(`${command} output exceeded ${maxBuffer} bytes`));
        if (target === 'stdout') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
      };
      child.stdout.on('data', capture('stdout'));
      child.stderr.on('data', capture('stderr'));
    }
    child.once('error', finish);
    child.once('close', code => {
      if (settled) return;
      if (pendingError) return finish(pendingError);
      if (code === 0) return finish(null, { stdout, stderr });
      const error = Error(`${command} exited with status ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      finish(error);
    });
    timer = setTimeout(() => stop(Error(`${command} timed out`)), timeoutMs);
    timer.unref();
  });
}

async function removeContainer(docker, containerName, options) {
  try {
    await runCommand(docker, ['rm', '-f', containerName], { ...options, timeoutMs: 10_000 });
  } catch (error) {
    const detail = `${error.stderr || ''} ${error.stdout || ''} ${error.message || ''}`;
    if (!/No such container/i.test(detail)) throw Error('Jet Browser container cleanup failed');
  }
  try {
    await runCommand(docker, ['inspect', containerName], { ...options, timeoutMs: 5000 });
    return false;
  } catch (error) {
    const detail = `${error.stderr || ''} ${error.stdout || ''}`;
    if (/No such object|No such container/i.test(detail)) return true;
    throw Error('Could not verify Jet Browser container cleanup');
  }
}

function evaluationValue(result) {
  const evaluation = result?.evaluation;
  if (evaluation?.exceptionDetails) throw Error(evaluation.exceptionDetails.text || 'Browser evaluation failed');
  return evaluation?.result?.value ?? result?.result?.value ?? result?.value ?? result;
}

function pngEvidence(value) {
  if (typeof value !== 'string') throw Error('Browser screenshot was not base64 text');
  const png = Buffer.from(value, 'base64');
  if (png.length < 1000 || !png.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
    throw Error('Browser screenshot was not a non-empty PNG');
  }
  return {
    screenshotBytes: png.length,
    screenshotSha256: createHash('sha256').update(png).digest('hex'),
  };
}

function createProtocol(child, { timeoutMs = 20_000 } = {}) {
  let stdout = '';
  let stderr = '';
  let outputBytes = 0;
  let fatalError = null;
  let lastCompletedOp = 'none';
  const waiters = [];
  let completionSettled = false;
  let completionFailure;
  let killTimer;

  const failWaiters = error => {
    while (waiters.length) waiters.shift().reject(error);
  };
  const terminate = error => {
    if (error && !fatalError) fatalError = error;
    if (fatalError) failWaiters(fatalError);
    child.stdin.destroy();
    signalProcessTree(child, 'SIGTERM');
    killTimer ??= setTimeout(() => signalProcessTree(child, 'SIGKILL'), 2000);
    killTimer.unref();
  };

  child.stdout.on('data', chunk => {
    outputBytes += chunk.length;
    if (outputBytes > 64 * 1024 * 1024) return terminate(Error('Standalone browser output exceeded 64 MiB'));
    stdout += chunk.toString('utf8');
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (!line) continue;
      const waiter = waiters.shift();
      if (!waiter) return terminate(Error('Standalone browser returned an unexpected response'));
      let response;
      try { response = JSON.parse(line); }
      catch (error) {
        waiter.reject(Error(`${waiter.op}: invalid JSON response: ${error.message}`));
        continue;
      }
      if (!response.ok) waiter.reject(Error(`${waiter.op}: ${response.error || 'Browser command failed'}`));
      else {
        lastCompletedOp = waiter.op;
        waiter.resolve(response.value);
      }
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });

  const completion = new Promise((resolvePromise, reject) => {
    child.once('error', error => {
      fatalError ??= error;
      failWaiters(fatalError);
    });
    child.once('close', code => {
      if (killTimer) clearTimeout(killTimer);
      const error = fatalError || (code === 0 ? null : Error(`Standalone browser exited (${code}); last completed operation: ${lastCompletedOp}${stderr ? `: ${stderr.trim()}` : ''}`));
      if (error) {
        failWaiters(error);
        reject(error);
      } else resolvePromise();
    });
  });
  completion.then(
    () => { completionSettled = true; },
    error => { completionSettled = true; completionFailure = error; },
  );

  const send = (command, commandTimeoutMs = timeoutMs) => new Promise((resolvePromise, reject) => {
    if (completionSettled) return reject(completionFailure || Error(`Standalone browser exited before ${command.op}`));
    let waiter;
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      const error = Error(`${command.op}: browser response timed out`);
      waiter.reject(error);
      terminate(error);
    }, commandTimeoutMs);
    timer.unref();
    waiter = {
      op: command.op,
      resolve: value => { clearTimeout(timer); resolvePromise(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    };
    waiters.push(waiter);
    child.stdin.write(`${JSON.stringify(command)}\n`, error => {
      if (!error) return;
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      waiter.reject(error);
      terminate(error);
    });
  });

  return { send, completion, terminate, stderr: () => stderr };
}

async function inspectEnvironment(docker, image, options) {
  const [imageResult, versionResult] = await Promise.all([
    runCommand(docker, ['image', 'inspect', '--format={{.Id}}', image], options),
    runCommand(docker, ['version', '--format={{.Server.Version}}'], options),
  ]);
  const sourceCommit = options.environment?.GITHUB_SHA;
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    dockerServerVersion: versionResult.stdout.trim(),
    imageId: imageResult.stdout.trim(),
    ...(/^[a-f0-9]{40}$/.test(sourceCommit || '') ? { sourceCommit } : {}),
  };
}

async function resourceSample(docker, containerName, startedAt, phase, options) {
  const [stats, top] = await Promise.all([
    runCommand(docker, ['stats', '--no-stream', '--format={{.MemUsage}}', containerName], { ...options, timeoutMs: 5000 }),
    runCommand(docker, ['top', containerName, '-eo', 'pid,args'], { ...options, timeoutMs: 5000 }),
  ]);
  const sample = {
    atMs: Math.max(0, Math.round(performance.now() - startedAt)),
    phase,
    memoryMiB: parseDockerMemoryMiB(stats.stdout),
    roles: processRolesFromDockerTop(top.stdout),
  };
  const exited = Object.entries(sample.roles).filter(([, alive]) => !alive).map(([role]) => role);
  if (exited.length) {
    const error = Error(`Runtime process exited: ${exited.join(', ')}`);
    error.roles = sample.roles;
    error.sample = sample;
    throw error;
  }
  return sample;
}

async function waitUntil(deadline, healthFailure) {
  while (Date.now() < deadline) {
    if (healthFailure()) throw healthFailure();
    await delay(Math.min(250, deadline - Date.now()));
  }
  if (healthFailure()) throw healthFailure();
}

export async function runStabilityBenchmark({
  durationSeconds,
  pageCount,
  churnCycles,
  sampleIntervalMs,
  output,
  image,
  noBuild,
  root = defaultRoot,
  docker = process.env.DOCKER || 'docker',
  environment = process.env,
  containerName = `jet-browser-stability-${randomUUID()}`,
} = {}) {
  const commandOptions = { cwd: root, environment };
  const outputPath = resolve(root, output);
  const report = {
    schemaVersion: 1,
    kind: 'jet-browser-stability',
    capturedAt: new Date().toISOString(),
    status: 'failed',
    configuration: {
      durationSeconds,
      pageCount,
      churnCycles,
      sampleIntervalMs,
      network: 'disabled',
      image,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      dockerServerVersion: 'unavailable',
      imageId: 'unavailable',
    },
    samples: { cycles: [], resources: [] },
    failures: [],
    cleanup: { extraPagesClosed: false, sessionClosed: false, containerRemoved: false },
  };
  let child;
  let protocol;
  let sessionCreated = false;
  let sampler;
  let sampleQueue = Promise.resolve();
  let healthFailure = null;
  let stage = 'build';
  let cycleNumber;
  let pageNumber;
  const startedAt = performance.now();

  const enqueueSample = phase => {
    sampleQueue = sampleQueue.then(async () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) throw Error('Standalone container exited before resource sampling');
      try {
        report.samples.resources.push(await resourceSample(docker, containerName, startedAt, phase, commandOptions));
      } catch (error) {
        if (error.sample) report.samples.resources.push(error.sample);
        throw error;
      }
    }).catch(error => { healthFailure ??= error; });
    return sampleQueue;
  };
  const assertHealthy = () => { if (healthFailure) throw healthFailure; };

  try {
    if (!noBuild) {
      await runCommand(docker, ['build', '-f', 'Dockerfile.standalone', '-t', image, '.'], {
        ...commandOptions,
        timeoutMs: 20 * 60_000,
        inherit: true,
      });
    }
    stage = 'inspect';
    report.environment = await inspectEnvironment(docker, image, commandOptions);
    stage = 'launch';
    const seccomp = resolve(root, 'seccomp_profile.json');
    child = spawn(docker, [
      'run', '--rm', '-i', '--name', containerName, '--network=none', '--cap-drop=ALL',
      '--cap-add=SETUID', '--cap-add=SETGID',
      '--security-opt=no-new-privileges', '--security-opt=systempaths=unconfined',
      '--security-opt=apparmor=unconfined', `--security-opt=seccomp=${seccomp}`,
      '--memory=1g', '--cpus=2', '--pids-limit=256', '--shm-size=256m',
      '--env=JET_BROWSER_SMOKE=1', image,
    ], {
      cwd: root,
      env: environment,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    protocol = createProtocol(child);
    stage = 'create';
    await protocol.send({ op: 'create', proxy: null, profile_dir: null, page_load_strategy: 'none' }, 30_000);
    sessionCreated = true;
    await enqueueSample('exercise');
    assertHealthy();
    sampler = setInterval(() => { void enqueueSample('exercise'); }, sampleIntervalMs);
    sampler.unref();

    const soakStartedAt = Date.now();
    const soakDeadline = soakStartedAt + durationSeconds * 1000;
    let primaryHandle = evaluationValue(await protocol.send({ op: 'current_window' }));
    if (typeof primaryHandle !== 'string' || !primaryHandle) throw Error('Primary browser window was not available');

    for (let cycleIndex = 0; cycleIndex < churnCycles; cycleIndex += 1) {
      cycleNumber = cycleIndex + 1;
      const scheduledAt = soakStartedAt + Math.floor((durationSeconds * 1000 * cycleIndex) / churnCycles);
      await waitUntil(scheduledAt, () => healthFailure);
      stage = 'exercise';
      report.cleanup.extraPagesClosed = false;
      const cycle = { cycle: cycleNumber, status: 'failed', startedAtMs: Math.round(performance.now() - startedAt), pages: [] };
      report.samples.cycles.push(cycle);
      const handles = [primaryHandle];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        pageNumber = pageIndex + 1;
        const marker = `cycle-${cycleNumber}-page-${pageNumber}-${randomUUID()}`;
        if (pageIndex > 0) {
          const opened = evaluationValue(await protocol.send({ op: 'new_window', kind: 'tab' }));
          const handle = opened?.handle;
          if (typeof handle !== 'string' || !handle) throw Error('New browser page did not return a handle');
          handles.push(handle);
          await protocol.send({ op: 'switch_window', handle });
        } else await protocol.send({ op: 'switch_window', handle: primaryHandle });
        const target = `http://127.0.0.1:8080/?marker=${encodeURIComponent(marker)}`;
        await protocol.send({ op: 'navigate', url: target });
        await waitForFixtureDocument(protocol.send, target, { attempts: 50, intervalMs: 100 });
        await protocol.send({ op: 'input', events: [
          { type: 'pointer', phase: 'down', x: 180, y: 42, button: 0 },
          { type: 'pointer', phase: 'up', x: 180, y: 42, button: 0 },
          { type: 'text', text: marker },
        ] });
        const checked = evaluationValue(await protocol.send({
          op: 'evaluate',
          expression: `(()=>{const expected=${JSON.stringify(marker)};sessionStorage.setItem('jet-stability-marker',expected);window.__jetStabilityMarker=expected;return {input:document.querySelector('#message')?.value,result:document.querySelector('#result')?.value,marker:document.querySelector('#marker')?.value,script:window.__jetStabilityMarker,stored:sessionStorage.getItem('jet-stability-marker')}})()`,
        }));
        if ([checked?.input, checked?.result, checked?.marker, checked?.script, checked?.stored].some(value => value !== marker)) {
          throw Error(`Page ${pageNumber} failed native input, script, or marker verification`);
        }
        const snapshot = await protocol.send({ op: 'snapshot' });
        if (snapshot?.url !== target || !snapshot?.text?.includes(marker)) throw Error(`Page ${pageNumber} failed semantic snapshot verification`);
        const screenshot = pngEvidence(await protocol.send({ op: 'screenshot' }));
        cycle.pages.push({
          page: pageNumber,
          marker,
          inputVerified: true,
          scriptVerified: true,
          snapshotVerified: true,
          ...screenshot,
        });
        assertHealthy();
      }

      stage = 'isolation';
      for (const [handleIndex, handle] of handles.entries()) {
        await protocol.send({ op: 'switch_window', handle });
        const expected = cycle.pages[handleIndex].marker;
        const observed = evaluationValue(await protocol.send({
          op: 'evaluate',
          expression: "(()=>({stored:sessionStorage.getItem('jet-stability-marker'),script:window.__jetStabilityMarker,marker:document.querySelector('#marker')?.value}))()",
        }));
        if (observed?.stored !== expected || observed?.script !== expected || observed?.marker !== expected) {
          throw Error(`Cross-page state contamination detected on page ${handleIndex + 1}`);
        }
      }

      stage = 'page-cleanup';
      let retainedHandle = primaryHandle;
      if (cycleIndex + 1 < churnCycles) {
        const opened = evaluationValue(await protocol.send({ op: 'new_window', kind: 'tab' }));
        retainedHandle = opened?.handle;
        if (typeof retainedHandle !== 'string' || !retainedHandle) {
          throw Error('Replacement browser page did not return a handle');
        }
      }
      const firstHandleToClose = retainedHandle === primaryHandle ? 1 : 0;
      for (let handleIndex = handles.length - 1; handleIndex >= firstHandleToClose; handleIndex -= 1) {
        await protocol.send({ op: 'switch_window', handle: handles[handleIndex] });
        await protocol.send({ op: 'close_window' });
      }
      await protocol.send({ op: 'switch_window', handle: retainedHandle });
      const remaining = evaluationValue(await protocol.send({ op: 'window_handles' }));
      if (!Array.isArray(remaining) || remaining.length !== 1 || remaining[0] !== retainedHandle) {
        throw Error('Extra browser pages remained after cleanup');
      }
      primaryHandle = retainedHandle;
      report.cleanup.extraPagesClosed = true;
      await enqueueSample('page-cleanup');
      assertHealthy();
      cycle.status = 'passed';
      cycle.completedAtMs = Math.round(performance.now() - startedAt);
      pageNumber = undefined;
    }

    stage = 'soak';
    await waitUntil(soakDeadline, () => healthFailure);
    const finalState = await protocol.send({ op: 'document_state' });
    if (finalState?.readyState !== 'complete' || !String(finalState.url || '').startsWith('http://127.0.0.1:8080/')) {
      throw Error('Browser did not remain responsive through the soak duration');
    }
    report.soakProbeVerified = true;
    report.soakDurationMs = Date.now() - soakStartedAt;
    report.status = 'passed';
  } catch (error) {
    report.failures.push({
      stage,
      ...(cycleNumber === undefined ? {} : { cycle: cycleNumber }),
      ...(pageNumber === undefined ? {} : { page: pageNumber }),
      ...(error.roles ? { roles: error.roles } : {}),
      message: safeError(error),
    });
  } finally {
    if (sampler) clearInterval(sampler);
    await sampleQueue;
    if (healthFailure && !report.failures.some(failure => failure.message === safeError(healthFailure))) {
      report.status = 'failed';
      report.failures.push({
        stage: 'resource-sampling',
        ...(healthFailure.roles ? { roles: healthFailure.roles } : {}),
        message: safeError(healthFailure),
      });
    }
    if (sessionCreated && protocol) {
      try {
        stage = 'session-cleanup';
        await protocol.send({ op: 'close' }, 10_000);
        report.cleanup.sessionClosed = true;
      } catch (error) {
        report.status = 'failed';
        report.failures.push({ stage, message: safeError(error) });
      }
    }
    if (child) {
      child.stdin.end();
      try {
        await Promise.race([
          protocol?.completion,
          delay(5000).then(() => { throw Error('Standalone container did not exit after session cleanup'); }),
        ]);
      } catch (error) {
        report.status = 'failed';
        protocol?.terminate();
        report.failures.push({ stage: 'container-exit', message: safeError(error) });
      }
    }
    try {
      report.cleanup.containerRemoved = await removeContainer(docker, containerName, commandOptions);
    } catch (error) {
      report.status = 'failed';
      report.failures.push({ stage: 'container-cleanup', message: safeError(error) });
    }
    if (!report.cleanup.containerRemoved || !report.cleanup.sessionClosed || !report.cleanup.extraPagesClosed) report.status = 'failed';
    if (report.status === 'failed' && !report.failures.length) {
      report.failures.push({ stage: 'cleanup', message: 'The run did not complete every cleanup invariant' });
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' });
    validateStabilityReport(report);
  }

  if (report.status !== 'passed') {
    const error = Error(`Jet Browser stability benchmark failed; evidence: ${outputPath}`);
    error.report = report;
    throw error;
  }
  return { report, outputPath };
}
