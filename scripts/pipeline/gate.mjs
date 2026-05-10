// Refuses to start if the latest readiness probe is red or stale (>2h).
// Used by both ingest and process workflows as a `needs:`-style gate.

import { loadReadiness, isHealthy } from './state.mjs';

const report = loadReadiness();
if (!report) {
  console.error('No readiness report found in pipeline-state branch. Run pipeline-readiness workflow first.');
  process.exit(1);
}
if (!isHealthy(report)) {
  console.error('Readiness probe is red or stale.');
  console.error(`  green=${report.green} at=${report.at}`);
  if (report.blockingFailures?.length) {
    console.error(`  blocking failures: ${report.blockingFailures.join(', ')}`);
  }
  console.error('Fix the issue or wait for the next probe (top of the hour).');
  process.exit(1);
}
console.log(`Readiness OK (probed ${report.at}).`);
