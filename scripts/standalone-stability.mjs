import { parseStabilityArguments } from './stability-report.mjs';
import { runStabilityBenchmark } from './stability-runner.mjs';

try {
  const configuration = parseStabilityArguments(process.argv.slice(2));
  const { report, outputPath } = await runStabilityBenchmark(configuration);
  console.log(JSON.stringify({
    status: report.status,
    durationSeconds: report.configuration.durationSeconds,
    churnCycles: report.samples.cycles.length,
    pagesPerCycle: report.configuration.pageCount,
    resourceSamples: report.samples.resources.length,
    output: outputPath,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
