const defaults = Object.freeze({
  durationSeconds: 10,
  pageCount: 3,
  churnCycles: 2,
  sampleIntervalMs: 1000,
  output: 'artifacts/stability-latest.json',
  image: process.env.JET_BROWSER_IMAGE || 'jet-browser:local',
  noBuild: false,
});

const integerArguments = Object.freeze({
  'duration-seconds': { key: 'durationSeconds', minimum: 5, maximum: 3600 },
  pages: { key: 'pageCount', minimum: 2, maximum: 8 },
  'churn-cycles': { key: 'churnCycles', minimum: 1, maximum: 100 },
  'sample-interval-ms': { key: 'sampleIntervalMs', minimum: 250, maximum: 60_000 },
});

export function parseStabilityArguments(values) {
  const result = { ...defaults };
  const seen = new Set();
  for (const value of values) {
    if (value === '--no-build') {
      if (seen.has('no-build')) throw Error('Duplicate argument: --no-build');
      seen.add('no-build');
      result.noBuild = true;
      continue;
    }
    if (!value.startsWith('--')) throw Error(`Unknown argument: ${value}`);
    const separator = value.indexOf('=');
    if (separator < 3) throw Error(`Use ${value}=value`);
    const name = value.slice(2, separator);
    const raw = value.slice(separator + 1);
    if (seen.has(name)) throw Error(`Duplicate argument: --${name}`);
    seen.add(name);
    const rule = integerArguments[name];
    if (rule) {
      if (!/^\d+$/.test(raw)) throw Error(`--${name} must be an integer`);
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < rule.minimum || parsed > rule.maximum) {
        throw Error(`--${name} must be between ${rule.minimum} and ${rule.maximum}`);
      }
      result[rule.key] = parsed;
      continue;
    }
    if (name === 'output' || name === 'image') {
      if (!raw.trim() || /[\0\r\n]/.test(raw)) throw Error(`--${name} cannot be empty`);
      result[name] = raw;
      continue;
    }
    throw Error(`Unknown argument: --${name}`);
  }
  return result;
}

const memoryUnits = Object.freeze({
  B: 1 / (1024 * 1024),
  KB: 1000 / (1024 * 1024),
  KiB: 1 / 1024,
  MB: 1_000_000 / (1024 * 1024),
  MiB: 1,
  GB: 1_000_000_000 / (1024 * 1024),
  GiB: 1024,
});

export function parseDockerMemoryMiB(value) {
  const match = String(value).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB)\b/);
  if (!match) throw Error('Docker memory usage was not recognized');
  const memoryMiB = Number(match[1]) * memoryUnits[match[2]];
  if (!Number.isFinite(memoryMiB) || memoryMiB < 0) throw Error('Docker memory usage was invalid');
  return Number(memoryMiB.toFixed(3));
}

export function processRolesFromDockerTop(value) {
  const output = String(value);
  return {
    browser: /(?:^|[\s/])(?:jet-browser-minibrowser|MiniBrowser)(?:\s|$)/m.test(output),
    driver: /(?:^|[\s/])WPEWebDriver(?:\s|$)/m.test(output),
    supervisor: /(?:^|[\s/])jet-browser-supervisor(?:\s|$)/m.test(output),
  };
}

function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw Error(`Invalid ${name}`);
}

function finite(value, name, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) throw Error(`Invalid ${name}`);
}

function validateConfiguration(configuration) {
  if (!configuration || typeof configuration !== 'object') throw Error('Missing stability configuration');
  integer(configuration.durationSeconds, 'durationSeconds', 5, 3600);
  integer(configuration.pageCount, 'pageCount', 2, 8);
  integer(configuration.churnCycles, 'churnCycles', 1, 100);
  integer(configuration.sampleIntervalMs, 'sampleIntervalMs', 250, 60_000);
  if (configuration.network !== 'disabled') throw Error('Stability networking must remain disabled');
  if (typeof configuration.image !== 'string' || !configuration.image || /[\0\r\n]/.test(configuration.image)) {
    throw Error('Missing stability image');
  }
}

function validateResourceSample(sample, passed) {
  integer(sample?.atMs, 'resource sample timestamp');
  finite(sample?.memoryMiB, 'resource sample memory');
  if (!['exercise', 'page-cleanup'].includes(sample?.phase)) throw Error('Invalid resource sample phase');
  for (const role of ['browser', 'driver', 'supervisor']) {
    if (typeof sample?.roles?.[role] !== 'boolean') throw Error(`Missing ${role} process status`);
    if (passed && !sample.roles[role]) throw Error(`${role} exited during a passing run`);
  }
}

function validatePageSample(page, expectedPage) {
  if (page?.page !== expectedPage) throw Error('Page samples are not ordered');
  if (typeof page.marker !== 'string' || !page.marker) throw Error('Missing page marker');
  for (const field of ['inputVerified', 'scriptVerified', 'snapshotVerified']) {
    if (page[field] !== true) throw Error(`Page is missing ${field}`);
  }
  integer(page.screenshotBytes, 'screenshot bytes', 1);
  if (!/^[a-f0-9]{64}$/.test(page.screenshotSha256 || '')) throw Error('Invalid screenshot hash');
}

export function validateStabilityReport(report) {
  if (!report || report.schemaVersion !== 1 || report.kind !== 'jet-browser-stability') {
    throw Error('Unsupported stability report schema');
  }
  if (Number.isNaN(Date.parse(report.capturedAt))) throw Error('Invalid stability capture time');
  if (!['passed', 'failed'].includes(report.status)) throw Error('Invalid stability status');
  const passed = report.status === 'passed';
  validateConfiguration(report.configuration);
  for (const field of ['node', 'platform', 'arch', 'dockerServerVersion', 'imageId']) {
    if (typeof report.environment?.[field] !== 'string' || !report.environment[field]) {
      throw Error(`Missing stability environment ${field}`);
    }
  }
  if (passed && !/^sha256:[a-f0-9]{64}$/.test(report.environment.imageId)) {
    throw Error('Passing stability report is missing an immutable image ID');
  }
  if (!Array.isArray(report.samples?.cycles) || !Array.isArray(report.samples?.resources)) {
    throw Error('Missing stability samples');
  }
  if (!Array.isArray(report.failures)) throw Error('Missing stability failures');
  if (passed && report.failures.length) throw Error('Passing stability report contains failures');
  if (!passed && !report.failures.length) throw Error('Failed stability report has no failure evidence');
  if (passed && report.samples.cycles.length !== report.configuration.churnCycles) {
    throw Error('Passing stability report is missing churn cycles');
  }
  if (passed && (!Number.isFinite(report.soakDurationMs) || report.soakDurationMs < report.configuration.durationSeconds * 1000)) {
    throw Error('Passing stability report did not cover the configured duration');
  }
  const markers = new Set();
  const screenshotHashes = new Set();
  for (const [cycleIndex, cycle] of report.samples.cycles.entries()) {
    if (cycle?.cycle !== cycleIndex + 1) throw Error('Cycle samples are not ordered');
    if (passed && cycle.status !== 'passed') throw Error('Passing report contains a failed cycle');
    if (!Array.isArray(cycle.pages)) throw Error('Cycle is missing page samples');
    if (passed && cycle.pages.length !== report.configuration.pageCount) {
      throw Error('Passing cycle is missing page samples');
    }
    for (const [pageIndex, page] of cycle.pages.entries()) {
      validatePageSample(page, pageIndex + 1);
      if (markers.has(page.marker)) throw Error('Page markers must be unique');
      markers.add(page.marker);
      if (passed && screenshotHashes.has(page.screenshotSha256)) throw Error('Fresh page screenshots must be distinct');
      screenshotHashes.add(page.screenshotSha256);
    }
  }
  if (passed && !report.samples.resources.some(sample => sample.phase === 'exercise')) {
    throw Error('Passing report is missing exercise resource samples');
  }
  if (passed && !report.samples.resources.some(sample => sample.phase === 'page-cleanup')) {
    throw Error('Passing report is missing post-cleanup resource samples');
  }
  for (const sample of report.samples.resources) validateResourceSample(sample, passed);
  for (const field of ['extraPagesClosed', 'sessionClosed', 'containerRemoved']) {
    if (typeof report.cleanup?.[field] !== 'boolean') throw Error(`Missing cleanup status ${field}`);
    if (passed && report.cleanup[field] !== true) throw Error(`Passing run did not complete ${field}`);
  }
  return report;
}
