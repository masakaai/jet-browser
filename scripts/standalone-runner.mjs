import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForFixtureDocument } from './standalone-readiness.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

function processResult(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0
      ? resolvePromise()
      : reject(Error(command + ' exited with status ' + code)));
  });
}

function cancellationError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Jet Browser verification was cancelled');
  error.name = 'AbortError';
  return error;
}

function markFatal(error) {
  try {
    Object.defineProperty(error, 'jetBrowserFatal', { value: true });
    return error;
  } catch {
    const wrapped = new Error(error.message, { cause: error });
    wrapped.name = error.name;
    wrapped.jetBrowserFatal = true;
    return wrapped;
  }
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

function runBoundedCommand(command, args, {
  cwd,
  env,
  timeout,
  terminationGraceMs,
  maxBuffer,
}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let pendingError;
    let forceTimer;
    let hardTimer;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolvePromise(result);
    };
    const terminate = error => {
      pendingError ??= error;
      signalProcessTree(child, 'SIGTERM');
      forceTimer ??= setTimeout(() => signalProcessTree(child, 'SIGKILL'), terminationGraceMs);
      hardTimer ??= setTimeout(() => finish(pendingError), terminationGraceMs * 2);
      forceTimer.unref();
      hardTimer.unref();
    };
    const capture = target => chunk => {
      outputBytes += chunk.length;
      if (outputBytes > maxBuffer) {
        terminate(Error(`${command} output exceeded ${maxBuffer} bytes`));
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.once('error', finish);
    child.once('close', code => {
      if (pendingError) return finish(pendingError);
      if (code === 0) return finish(null, { stdout, stderr });
      const error = Error(`${command} exited with status ${code}`);
      error.code = code;
      finish(error);
    });
    const timeoutTimer = setTimeout(() => {
      const error = Error(`${command} timed out`);
      error.code = 'ETIMEDOUT';
      terminate(error);
    }, timeout);
    timeoutTimer.unref();
  });
}

async function removeContainer(docker, containerName, options) {
  try {
    await runBoundedCommand(docker, ['rm', '-f', containerName], {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 64 * 1024,
      timeout: options.timeout,
      terminationGraceMs: options.terminationGraceMs,
    });
  } catch (error) {
    const detail = `${error?.stderr || ''} ${error?.stdout || ''} ${error?.message || ''}`;
    if (/No such container/i.test(detail)) return;
    throw new Error('Jet Browser container cleanup failed');
  }
}

export async function runStandaloneSmoke({
  root = defaultRoot,
  image = process.env.JET_BROWSER_IMAGE || 'jet-browser:local',
  docker = process.env.DOCKER || 'docker',
  noBuild = false,
  signal,
  environment = process.env,
  containerName = `jet-browser-smoke-${randomUUID()}`,
  terminationGraceMs = 2_000,
  cleanupTimeoutMs = 10_000,
  startupTimeoutMs = 20_000,
} = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerName)) {
    throw new Error('Invalid Jet Browser smoke container name');
  }
  if (!Number.isInteger(terminationGraceMs) || terminationGraceMs < 1 || terminationGraceMs > 10_000) {
    throw new Error('Invalid Jet Browser termination grace');
  }
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 60_000) {
    throw new Error('Invalid Jet Browser cleanup timeout');
  }
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120_000) {
    throw new Error('Invalid Jet Browser startup timeout');
  }
  if (signal?.aborted) throw cancellationError(signal);

  const seccomp = resolve(root, 'seccomp_profile.json');
  if (!noBuild) {
    await processResult(docker, [
      'build', '-f', 'Dockerfile.standalone', '-t', image, '.'
    ], { cwd: root, env: environment, signal });
  }

  const child = spawn(docker, [
    'run', '--rm', '-i', '--name', containerName, '--network=none', '--cap-drop=ALL',
    '--cap-add=SETUID', '--cap-add=SETGID',
    '--security-opt=no-new-privileges', '--security-opt=systempaths=unconfined',
    '--security-opt=apparmor=unconfined', '--security-opt=seccomp=' + seccomp,
    '--memory=1g', '--cpus=2',
    '--pids-limit=256', '--shm-size=256m', '--env=JET_BROWSER_SMOKE=1', image
  ], {
    cwd: root,
    env: environment,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBytes = 0;
  let stdoutBuffer = '';
  let stderr = '';
  let outputError = null;
  let lastCompletedOp = 'none';
  let killTimer;
  const responseWaiters = [];

  const failWaiters = error => {
    while (responseWaiters.length) responseWaiters.shift().reject(error);
  };
  const terminateChild = error => {
    if (error && !outputError) {
      outputError = markFatal(error);
      failWaiters(outputError);
    }
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) signalProcessTree(child, 'SIGTERM');
    if (!killTimer) {
      killTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), terminationGraceMs);
      killTimer.unref();
    }
  };
  const onAbort = () => terminateChild(cancellationError(signal));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 24 * 1024 * 1024) {
      terminateChild(Error('Standalone browser output exceeded 24 MiB'));
      return;
    }
    stdoutBuffer += chunk.toString('utf8');
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const waiter = responseWaiters.shift();
      if (!waiter) {
        terminateChild(Error('Standalone browser returned an unexpected response'));
        return;
      }
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        waiter.reject(Error(`${waiter.op}: invalid JSON response: ${error.message}`));
        continue;
      }
      if (!response.ok) waiter.reject(Error(`${waiter.op}: ${response.error || 'Browser command failed'}`));
      else waiter.resolve(response.value);
    }
  });
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk).slice(-4000);
  });

  const completion = new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      terminateChild(Error('Standalone browser smoke test timed out'));
    }, 90_000);
    child.once('error', error => {
      terminateChild(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const exitError = outputError || markFatal(Error(`Standalone browser exited before responding (${code}); last completed operation: ${lastCompletedOp}`));
      failWaiters(exitError);
      if (outputError) return reject(outputError);
      if (code !== 0) {
        return reject(markFatal(Error('Standalone browser exited (' + code + ')' + (stderr ? ': ' + stderr.trim() : ''))));
      }
      resolvePromise();
    });
  });
  let completionSettled = false;
  let completionFailure;
  const observedCompletion = completion.then(
    value => { completionSettled = true; return value; },
    error => { completionSettled = true; completionFailure = error; throw error; },
  );
  observedCompletion.catch(() => {});

  const target = 'http://127.0.0.1:8080/';
  const send = (command, responseTimeoutMs = 20_000) => new Promise((resolvePromise, reject) => {
    const op = command.op;
    if (completionSettled) {
      reject(completionFailure || markFatal(Error(`Standalone browser exited before ${op}`)));
      return;
    }
    const timer = setTimeout(() => {
      const index = responseWaiters.indexOf(waiter);
      if (index >= 0) responseWaiters.splice(index, 1);
      reject(Error(`${op}: browser response timed out`));
    }, responseTimeoutMs);
    const waiter = {
      op,
      resolve: value => { clearTimeout(timer); lastCompletedOp = op; resolvePromise(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    };
    responseWaiters.push(waiter);
    child.stdin.write(JSON.stringify(command) + '\n', error => {
      if (!error) return;
      const index = responseWaiters.indexOf(waiter);
      if (index >= 0) responseWaiters.splice(index, 1);
      waiter.reject(error);
    });
  });

  let title;
  let value;
  let screenshotBytes;
  let primaryError;
  try {
    await send({ op: 'create', proxy: null, profile_dir: null, page_load_strategy: 'none' }, startupTimeoutMs);
    await send({ op: 'navigate', url: target });
    await waitForFixtureDocument(send, target);
    const snapshot = await send({ op: 'snapshot' });
    title = snapshot?.title;
    if (title !== 'Jet Browser Ready' || snapshot?.url !== target) throw Error('Unexpected page snapshot');
    await send({ op: 'input', events: [
      { type: 'pointer', phase: 'down', x: 180, y: 42, button: 0 },
      { type: 'pointer', phase: 'up', x: 180, y: 42, button: 0 },
      { type: 'text', text: 'open-source runtime' }
    ] });
    const evaluation = await send({ op: 'evaluate', expression: "(()=>({value:document.querySelector('#message').value,result:document.querySelector('#result').value}))()" });
    value = evaluation?.result?.value ?? evaluation?.value ?? evaluation;
    if (value?.value !== 'open-source runtime' || value?.result !== 'open-source runtime') {
      throw Error('Native text input did not update the page');
    }
    const screenshot = await send({ op: 'screenshot' });
    if (typeof screenshot !== 'string') throw Error('Browser screenshot was not base64 text');
    const png = Buffer.from(screenshot, 'base64');
    screenshotBytes = png.length;
    if (screenshotBytes < 1000 || !png.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
      throw Error('Browser screenshot was not a non-empty PNG');
    }
    await send({ op: 'close' });
    child.stdin.end();
    await observedCompletion;
  } catch (error) {
    primaryError = outputError || error;
    terminateChild();
    await Promise.race([
      observedCompletion.catch(() => {}),
      delay(terminationGraceMs + 1_000),
    ]);
    if (!completionSettled) {
      child.stdout.destroy();
      child.stderr.destroy();
    }
    if (stderr && primaryError.name !== 'AbortError') {
      primaryError = Error(primaryError.message + ': ' + stderr.trim());
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      await removeContainer(docker, containerName, {
        cwd: root,
        env: environment,
        timeout: cleanupTimeoutMs,
        terminationGraceMs: Math.min(terminationGraceMs, 1_000),
      });
    } catch (cleanupError) {
      if (primaryError) {
        const combined = new Error(`${primaryError.message}; ${cleanupError.message}`, { cause: primaryError });
        combined.name = primaryError.name;
        primaryError = combined;
      } else primaryError = cleanupError;
    }
  }

  if (primaryError) throw primaryError;
  return {
    status: 'passed',
    network: 'disabled',
    title,
    input: value.value,
    screenshotBytes,
  };
}
