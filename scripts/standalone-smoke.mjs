import { runStandaloneSmoke } from './standalone-runner.mjs';

const result = await runStandaloneSmoke({
  noBuild: process.argv.includes('--no-build'),
});

console.log(JSON.stringify(result, null, 2));
