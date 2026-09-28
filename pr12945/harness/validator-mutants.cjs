// Each validator mutant removes one assertion from hosted-latency-baseline.ts;
// run the PR's 18 unit tests against it. usage: node validator-mutants.cjs <wt>
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const wt = process.argv[2];
const file = `${wt}/integration-tests/helpers/hosted-latency-baseline.ts`;
const pristine = execFileSync('git', ['-C', wt, 'show', 'HEAD:integration-tests/helpers/hosted-latency-baseline.ts'], { encoding: 'utf8' });
const M = [
  ['V1 version', `assert.equal(report.version, 1);`, ``],
  ['V2 provider', `assert.equal(report.provider, 'local-openai-fixture');`, ``],
  ['V3 delay constant', `assert.equal(report.runtimeProvisioningDelayMs, HOSTED_PROVISIONING_DELAY_MS);`, ``],
  ['V4 scenario set', `assert.deepEqual(report.samples.map((sample) => sample.scenario).sort(), [\n    'no-tool',\n    'tool',\n  ]);`, ``],
  ['V5 sample times finite', `      time(sample[name], name);`, `      void name;`],
  ['V6 storeRequests>0', `Number.isSafeInteger(sample.storeRequests) && sample.storeRequests > 0,`, `true,`],
  ['V7 ready-warm>=delay', `sample.runtimeReadyMs - sample.warmRequestedMs >=\n        HOSTED_PROVISIONING_DELAY_MS,`, `true,`],
  ['V8 visible<=complete', `assert(sample.firstVisibleTextMs <= sample.turnCompleteMs);`, ``],
  ['V9 round count', `assert.equal(sample.modelRounds.length, sample.scenario === 'tool' ? 2 : 1);`, ``],
  ['V10 round times finite', `        time(round[name], name);`, `        void name;`],
  ['V11 round internal order', `round.requestMs <= round.firstTextMs &&\n          round.firstTextMs <= round.finishedMs,`, `true,`],
  ['V12 model text<ready', `first.firstTextMs < sample.runtimeReadyMs,`, `true,`],
  ['V13 lastFinished<=visible', `assert(sample.modelRounds.at(-1)!.finishedMs <= sample.firstVisibleTextMs);`, ``],
  ['V14 no-tool warm<=complete', `sample.warmRequestedMs <= sample.turnCompleteMs,`, `true,`],
  ['V15 no-tool complete<ready', `sample.turnCompleteMs < sample.runtimeReadyMs,`, `true,`],
  ['V16 no-tool nulls', `      assert.equal(sample.acquireMs, null);\n      assert.equal(sample.executionStartMs, null);\n      assert.equal(sample.toolWaitMs, null);\n      assert.equal(sample.sameContext, null);`, ``],
  ['V17 tool times finite', `      time(sample.acquireMs, 'acquireMs');\n      time(sample.executionStartMs, 'executionStartMs');\n      time(sample.toolWaitMs, 'toolWaitMs');`, ``],
  ['V18 tool finished<ready', `first.finishedMs < sample.runtimeReadyMs,`, `true,`],
  ['V19 toolWait definition', `assert.equal(sample.toolWaitMs, sample.runtimeReadyMs - first.finishedMs);`, ``],
  ['V20 ready<=acquire', `assert(sample.runtimeReadyMs <= sample.acquireMs);`, ``],
  ['V21 acquire<=exec', `assert(sample.acquireMs <= sample.executionStartMs);`, ``],
  ['V22 exec<continuation', `assert(sample.executionStartMs < sample.modelRounds[1].requestMs);`, ``],
  ['V23 sameContext', `assert.equal(sample.sameContext, true);`, ``],
  ['C1 compare skips baseline validation', `  validateHostedLatency(baseline);\n  validateHostedLatency(current);`, `  validateHostedLatency(current);`],
  ['C2 compare skips current validation', `  validateHostedLatency(baseline);\n  validateHostedLatency(current);`, `  validateHostedLatency(baseline);`],
];
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const OUT = require('path').join(__dirname, 'vitest-out.json');
function run() {
  fs.rmSync(OUT, { force: true });
  const r = spawnSync('npx', ['vitest', 'run', 'cli/hosted-latency-baseline.test.ts', '--retry=0', '--reporter=json', '--outputFile=' + OUT], { cwd: `${wt}/integration-tests`, encoding: 'utf8', maxBuffer: 64e6 });
  const j = JSON.parse(fs.readFileSync(OUT, 'utf8')); fs.rmSync(OUT);
  const failed = j.testResults.flatMap((f) => f.assertionResults).filter((t) => t.status !== 'passed').map((t) => t.title);
  return { total: j.numTotalTests, passed: j.numPassedTests, failed };
}
try {
  fs.writeFileSync(file, pristine);
  const base = run();
  console.log(`BASELINE passed ${base.passed}/${base.total}`);
  if (base.passed !== base.total || base.total !== 18) process.exit(2);
  for (const [name, from, to] of M) {
    if (only && !only.has(name.split(' ')[0])) continue;
    const i = pristine.indexOf(from);
    if (i < 0 || pristine.indexOf(from, i + 1) >= 0) { console.log(`${name}: ANCHOR ${i < 0 ? 'MISSING' : 'AMBIGUOUS'}`); continue; }
    fs.writeFileSync(file, pristine.slice(0, i) + to + pristine.slice(i + from.length));
    const r = run();
    console.log(`${name}: ${r.failed.length ? 'KILLED' : 'SURVIVED'} (${r.passed}/${r.total})${r.failed.length ? ' by ' + r.failed.join(' | ') : ''}`);
  }
} finally {
  fs.writeFileSync(file, pristine);
}
