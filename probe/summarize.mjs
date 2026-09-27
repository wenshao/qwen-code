// Prints one PROBE_JSON line per arm from its log and JSON report.
import { existsSync, readFileSync } from 'node:fs';

const [arm, rc, secs, mutation] = process.argv.slice(2);
const log = readFileSync(`probe-out/${arm}.txt`, 'utf8');
const json = 'integration-tests/hosted-process-suite.json';
const summary = { arm, mutation, exitCode: Number(rc), seconds: Number(secs) };
summary.testsLine = log.match(/^\s*Tests\s+.*$/m)?.[0].trim() ?? null;
summary.errorLines = log.split('\n').filter((l) => l.includes('::error::'));
if (existsSync(json)) {
  const r = JSON.parse(readFileSync(json, 'utf8'));
  Object.assign(summary, {
    numTotalTests: r.numTotalTests,
    numPassedTests: r.numPassedTests,
    numFailedTests: r.numFailedTests,
    numPendingTests: r.numPendingTests,
    cases: r.testResults.flatMap((f) =>
      f.assertionResults.map((a) => ({
        title: a.title,
        status: a.status,
        ms: Math.round(a.duration ?? 0),
      })),
    ),
  });
}
console.log(`PROBE_JSON ${JSON.stringify(summary)}`);
