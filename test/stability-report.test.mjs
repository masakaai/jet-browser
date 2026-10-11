import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStabilityArguments,
  parseDockerMemoryMiB,
  processRolesFromDockerTop,
  validateStabilityReport,
} from '../scripts/stability-report.mjs';

const validReport = () => ({
  schemaVersion: 1,
  kind: 'jet-browser-stability',
  capturedAt: '2026-10-12T00:00:00.000Z',
  status: 'passed',
  soakDurationMs: 10_050,
  configuration: {
    durationSeconds: 10,
    pageCount: 2,
    churnCycles: 1,
    sampleIntervalMs: 1000,
    network: 'disabled',
    image: 'jet-browser:local',
  },
  environment: {
    node: 'v24.0.0',
    platform: 'linux',
    arch: 'x64',
    dockerServerVersion: '29.0.0',
    imageId: `sha256:${'0'.repeat(64)}`,
    sourceCommit: '1'.repeat(40),
  },
  samples: {
    cycles: [
      {
        cycle: 1,
        status: 'passed',
        pages: [
          {
            page: 1,
            marker: 'cycle-1-page-1',
            inputVerified: true,
            scriptVerified: true,
            snapshotVerified: true,
            screenshotBytes: 2048,
            screenshotSha256: 'a'.repeat(64),
          },
          {
            page: 2,
            marker: 'cycle-1-page-2',
            inputVerified: true,
            scriptVerified: true,
            snapshotVerified: true,
            screenshotBytes: 2048,
            screenshotSha256: 'b'.repeat(64),
          },
        ],
      },
    ],
    resources: [
      {
        atMs: 1000,
        phase: 'exercise',
        memoryMiB: 201.5,
        roles: { browser: true, driver: true, supervisor: true },
      },
      {
        atMs: 2000,
        phase: 'page-cleanup',
        memoryMiB: 198.25,
        roles: { browser: true, driver: true, supervisor: true },
      },
    ],
  },
  failures: [],
  cleanup: {
    extraPagesClosed: true,
    sessionClosed: true,
    containerRemoved: true,
  },
});

test('stability arguments use a bounded CI-safe default', () => {
  assert.deepEqual(parseStabilityArguments([]), {
    durationSeconds: 10,
    pageCount: 3,
    churnCycles: 2,
    sampleIntervalMs: 1000,
    output: 'artifacts/stability-latest.json',
    image: 'jet-browser:local',
    noBuild: false,
  });
});

test('stability arguments accept explicit bounded values', () => {
  assert.deepEqual(parseStabilityArguments([
    '--duration-seconds=45',
    '--pages=4',
    '--churn-cycles=5',
    '--sample-interval-ms=750',
    '--output=/tmp/result.json',
    '--image=ghcr.io/masakaai/jet-browser:v0.9.0',
    '--no-build',
  ]), {
    durationSeconds: 45,
    pageCount: 4,
    churnCycles: 5,
    sampleIntervalMs: 750,
    output: '/tmp/result.json',
    image: 'ghcr.io/masakaai/jet-browser:v0.9.0',
    noBuild: true,
  });
});

test('stability arguments reject unknown, duplicate, or unsafe values', () => {
  for (const values of [
    ['duration-seconds=10'],
    ['--unknown=1'],
    ['--pages=1'],
    ['--pages=9'],
    ['--churn-cycles=0'],
    ['--duration-seconds=4'],
    ['--sample-interval-ms=249'],
    ['--pages=3', '--pages=4'],
    ['--no-build=true'],
    ['--output='],
    ['--image='],
  ]) assert.throws(() => parseStabilityArguments(values));
});

test('docker memory parser normalizes binary and decimal units', () => {
  assert.equal(parseDockerMemoryMiB('201.5MiB / 1GiB'), 201.5);
  assert.equal(parseDockerMemoryMiB('1.5GiB / 2GiB'), 1536);
  assert.equal(parseDockerMemoryMiB('104.8576MB / 1GB'), 100);
  assert.throws(() => parseDockerMemoryMiB('not available'));
});

test('docker top parsing distinguishes browser, driver, and supervisor', () => {
  const all = processRolesFromDockerTop(`PID COMMAND\n12 /usr/local/bin/jet-browser-supervisor\n13 /usr/bin/WPEWebDriver --port=9515\n14 /usr/local/bin/jet-browser-minibrowser --automation`);
  assert.deepEqual(all, { browser: true, driver: true, supervisor: true });
  const driverExited = processRolesFromDockerTop(`PID COMMAND\n12 /usr/local/bin/jet-browser-supervisor\n14 /usr/local/bin/jet-browser-minibrowser --automation`);
  assert.deepEqual(driverExited, { browser: true, driver: false, supervisor: true });
});

test('stability report accepts complete passing evidence', () => {
  assert.equal(validateStabilityReport(validReport()).status, 'passed');
});

test('stability report preserves a partial failed run with role evidence', () => {
  const report = validReport();
  report.status = 'failed';
  report.samples.cycles = [];
  report.samples.resources[0].roles.driver = false;
  report.failures = [{
    stage: 'resource-sampling',
    roles: { browser: true, driver: false, supervisor: true },
    message: 'Runtime process exited: driver',
  }];
  report.cleanup.extraPagesClosed = false;
  report.cleanup.sessionClosed = false;
  assert.equal(validateStabilityReport(report).status, 'failed');
});

test('stability report rejects missing evidence and inconsistent outcomes', () => {
  const cases = [];
  const missingCleanupSample = validReport();
  missingCleanupSample.samples.resources.pop();
  cases.push(missingCleanupSample);
  const missingRole = validReport();
  missingRole.samples.resources[0].roles.driver = false;
  cases.push(missingRole);
  const missingScreenshot = validReport();
  missingScreenshot.samples.cycles[0].pages[0].screenshotBytes = 0;
  cases.push(missingScreenshot);
  const passedWithFailure = validReport();
  passedWithFailure.failures.push({ stage: 'exercise', message: 'failed' });
  cases.push(passedWithFailure);
  const failedWithoutFailure = validReport();
  failedWithoutFailure.status = 'failed';
  cases.push(failedWithoutFailure);
  const incompleteCleanup = validReport();
  incompleteCleanup.cleanup.containerRemoved = false;
  cases.push(incompleteCleanup);
  const unboundedConfiguration = validReport();
  unboundedConfiguration.configuration.pageCount = 9;
  cases.push(unboundedConfiguration);
  const shortSoak = validReport();
  shortSoak.soakDurationMs = 9999;
  cases.push(shortSoak);
  const staleScreenshot = validReport();
  staleScreenshot.samples.cycles[0].pages[1].screenshotSha256 = staleScreenshot.samples.cycles[0].pages[0].screenshotSha256;
  cases.push(staleScreenshot);
  const invalidCommit = validReport();
  invalidCommit.environment.sourceCommit = 'main';
  cases.push(invalidCommit);
  for (const report of cases) assert.throws(() => validateStabilityReport(report));
});
