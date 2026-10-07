import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = process.env.JET_BROWSER_IMAGE || 'jet-browser:local';
const docker = process.env.DOCKER || 'docker';
const seccomp = resolve(root, 'seccomp_profile.json');
const noBuild = process.argv.includes('--no-build');

function processResult(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0
      ? resolvePromise()
      : reject(Error(command + ' exited with status ' + code)));
  });
}

if (!noBuild) {
  await processResult(docker, [
    'build', '-f', 'Dockerfile.standalone', '-t', image, '.'
  ], { cwd: root });
}

const readinessProbes = 12;
const commands = [
  { op: 'create', proxy: null, profile_dir: null, page_load_strategy: 'none' },
  { op: 'navigate', url: 'http://127.0.0.1:8080/' },
  ...Array.from({ length: readinessProbes }, () => ({ op: 'document_state' })),
  { op: 'snapshot' },
  { op: 'input', events: [
    { type: 'pointer', phase: 'down', x: 180, y: 42, button: 0 },
    { type: 'pointer', phase: 'up', x: 180, y: 42, button: 0 },
    { type: 'text', text: 'open-source runtime' }
  ] },
  { op: 'evaluate', expression: "(()=>({value:document.querySelector('#message').value,result:document.querySelector('#result').value}))()" },
  { op: 'screenshot' },
  { op: 'close' }
];

const child = spawn(docker, [
  'run', '--rm', '-i', '--network=none', '--cap-drop=ALL',
  '--cap-add=SETUID', '--cap-add=SETGID',
  '--security-opt=no-new-privileges', '--security-opt=systempaths=unconfined',
  '--security-opt=apparmor=unconfined', '--security-opt=seccomp=' + seccomp,
  '--memory=1g', '--cpus=2',
  '--pids-limit=256', '--shm-size=256m', '--env=JET_BROWSER_SMOKE=1', image
], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });

const stdout = [];
let stdoutBytes = 0;
let stderr = '';
let outputError = null;
child.stdout.on('data', chunk => {
  stdoutBytes += chunk.length;
  if (stdoutBytes > 24 * 1024 * 1024) {
    outputError = Error('Standalone browser output exceeded 24 MiB');
    child.kill('SIGKILL');
    return;
  }
  stdout.push(chunk);
});
child.stderr.on('data', chunk => {
  stderr = (stderr + chunk).slice(-4000);
});

const completion = new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(Error('Standalone browser smoke test timed out'));
  }, 90_000);
  child.once('error', error => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('close', code => {
    clearTimeout(timer);
    if (outputError) return reject(outputError);
    if (code !== 0) {
      return reject(Error('Standalone browser exited (' + code + ')' + (stderr ? ': ' + stderr.trim() : '')));
    }
    resolvePromise();
  });
});

child.stdin.end(commands.map(command => JSON.stringify(command)).join('\n') + '\n');
await completion;

const lines = Buffer.concat(stdout).toString('utf8').trim().split('\n').filter(Boolean);
if (lines.length !== commands.length) {
  throw Error('Expected ' + commands.length + ' browser responses, received ' + lines.length);
}
const responses = lines.map((line, index) => {
  let response;
  try {
    response = JSON.parse(line);
  } catch (error) {
    throw Error(commands[index].op + ': invalid JSON response: ' + error.message);
  }
  if (!response.ok) {
    throw Error(commands[index].op + ': ' + (response.error || 'Browser command failed') +
      (stderr ? ': ' + stderr.trim() : ''));
  }
  return response.value;
});

const probeStart = 2;
const snapshotIndex = probeStart + readinessProbes;
const target = 'http://127.0.0.1:8080/';
const ready = responses.slice(probeStart, snapshotIndex).some(state =>
  state?.url === target && ['interactive', 'complete'].includes(state.readyState));
if (!ready) throw Error('Fixture document did not become ready');
const snapshot = responses[snapshotIndex];
const title = snapshot?.title;
if (title !== 'Jet Browser Ready' || snapshot?.url !== target) throw Error('Unexpected page snapshot');
const evaluation = responses[snapshotIndex + 2];
const value = evaluation?.result?.value ?? evaluation?.value ?? evaluation;
if (value?.value !== 'open-source runtime' || value?.result !== 'open-source runtime') {
  throw Error('Native text input did not update the page');
}
const screenshotBytes = Buffer.from(responses[snapshotIndex + 3], 'base64').length;
if (screenshotBytes < 1000) throw Error('Browser screenshot was unexpectedly small');

console.log(JSON.stringify({
  status: 'passed',
  network: 'disabled',
  title,
  input: value.value,
  screenshotBytes
}, null, 2));
