import { summarize } from './stats.mjs';

const metrics = ['browserReadyMs', 'activeMemoryMiB'];

export function validateRuntimeReport(report) {
  if (!report || report.schemaVersion !== 1) throw Error('Unsupported runtime report schema');
  if (!report.method || !Number.isInteger(report.method.runs) || report.method.runs < 1) throw Error('Runtime report is missing its run count');
  const implementations = Object.entries(report.implementations || {});
  if (!implementations.length) throw Error('Runtime report needs at least one implementation');
  for (const [name, implementation] of implementations) {
    if (!/^[a-f0-9]{40}$/.test(implementation.commit || '')) throw Error(`${name} is missing a pinned source commit`);
    if (!implementation.license) throw Error(`${name} is missing a license`);
    if (!Array.isArray(implementation.samples) || implementation.samples.length !== report.method.runs) throw Error(`${name} does not contain the requested number of samples`);
    const passed = (implementation.samples || []).filter(sample => sample.status === 'passed');
    if (!passed.length) throw Error(`${name} needs at least one passed sample`);
    for (const sample of passed) {
      if(sample.scriptVerified!==true)throw Error(`${name} is missing verified script execution`);
      for (const metric of metrics) {
        if (!Number.isFinite(Number(sample[metric])) || Number(sample[metric]) < 0) throw Error(`${name} has an invalid ${metric} sample`);
      }
    }
  }
  return report;
}

export function summarizeRuntimeReport(report) {
  validateRuntimeReport(report);
  const implementations = {};
  for (const [name, implementation] of Object.entries(report.implementations)) {
    const passed = implementation.samples.filter(sample => sample.status === 'passed');
    implementations[name] = {
      commit: implementation.commit,
      image: implementation.image || null,
      imageDigest: implementation.imageDigest || null,
      license: implementation.license,
      requested: implementation.samples.length,
      passed: passed.length,
      successRate: Number((passed.length / implementation.samples.length).toFixed(4)),
      ...Object.fromEntries(metrics.map(metric => [metric, summarize(passed.map(sample => sample[metric]))])),
    };
  }
  return {
    schemaVersion: report.schemaVersion,
    capturedAt: report.capturedAt,
    method: report.method,
    system: report.system,
    implementations,
  };
}

export const runtimeMetrics = Object.freeze([...metrics]);
