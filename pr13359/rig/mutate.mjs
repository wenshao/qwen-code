// Mutation matrix for PR #13359. Each mutant is one exact-anchor replacement
// (fail-closed: a missing or non-unique anchor aborts). The original file is
// restored after every run. Usage: node mutate.mjs ts|java
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const S =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f2664731-3690-4937-833c-9c220ef51e4c/scratchpad';
const M = `${S}/wt-mut`;
const kind = process.argv[2];
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const TS_FILE = `${M}/packages/cli/src/serve/hosted-harness-session.ts`;
const J = `${M}/packages/sdk-java/managed-agent-server`;
const CONNECTOR = `${J}/src/main/java/com/alibaba/qwen/code/managedagent/harness/QwenHostedHarnessConnector.java`;
const PROPS = `${J}/src/main/java/com/alibaba/qwen/code/managedagent/config/ManagedAgentProperties.java`;

const tsMutants = [
  ['M1 timer aborts without reason', TS_FILE, '() => abort.abort(HOSTED_TURN_DEADLINE),', '() => abort.abort(),'],
  ['M2 deadline classified as cancelled', TS_FILE, "? { state: 'error', stopReason: 'deadline_exceeded' }", "? { state: 'cancelled', stopReason: 'cancelled' }"],
  ['M3 envelope drops deadline code', TS_FILE, "code: expired ? 'hosted_turn_deadline_exceeded' : 'hosted_turn_failed',", "code: 'hosted_turn_failed',"],
  ['M4 retried-settlement path reverted', TS_FILE, 'const outcome = settledTurnOutcome(abort);\n            await session.managed.sink.write(', "const outcome = abort.signal.aborted ? { state: 'cancelled' as const, stopReason: 'cancelled' } : { state: 'error' as const, stopReason: 'error' };\n            await session.managed.sink.write("],
  ['M5 runner catch path reverted', TS_FILE, 'const outcome = settledTurnOutcome(abort);\n          state = outcome.state;', "const outcome = abort.signal.aborted ? { state: 'cancelled' as const, stopReason: 'cancelled' } : { state: 'error' as const, stopReason: 'error' };\n          state = outcome.state;"],
  ['M6 deadline projected as turn_complete', TS_FILE, "if (outcome === 'completed' || outcome === 'cancelled') {", "if (outcome === 'completed' || outcome === 'cancelled' || event.payload['stopReason'] === 'deadline_exceeded') {"],
];
const javaMutants = [
  ['J1 connector omits deadline', CONNECTOR, '.payloadDigest(payloadDigest)\n                .deadline(properties.getTurnDeadline());', '.payloadDigest(payloadDigest);'],
  ['J2 boot validation removed', CONNECTOR, 'throw new IllegalStateException("Hosted Harness turn deadline must"', 'if (false) throw new IllegalStateException("Hosted Harness turn deadline must"'],
  ['J3 1 ms rejected (lower bound off by one)', CONNECTOR, '|| turnDeadline.compareTo(Duration.ofMillis(1)) < 0', '|| turnDeadline.compareTo(Duration.ofMillis(1)) <= 0'],
  ['J4 max rejected (upper bound off by one)', CONNECTOR, 'Duration.ofMillis(Integer.MAX_VALUE)) > 0) {', 'Duration.ofMillis(Integer.MAX_VALUE)) >= 0) {'],
  ['J5 property default 30m -> 30s', PROPS, 'private Duration turnDeadline = Duration.ofMinutes(30);', 'private Duration turnDeadline = Duration.ofSeconds(30);'],
];

function apply(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor count ${n} in ${file}: ${from.slice(0, 60)}`);
  fs.writeFileSync(file, src.replace(from, to));
  return src;
}

function runTs() {
  const r = spawnSync('npx', ['vitest', 'run', 'src/serve/hosted-harness-session.test.ts', '-t', 'deadline-exceeded turn as a classified failure|deadline expiry on the retried settlement path|settles a cancelled turn when writing its user record fails once|reports an aborted turn as cancelled to the Java event projector'], { cwd: `${M}/packages/cli`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = strip(r.stdout + r.stderr);
  const tests = out.match(/Tests\s+([^\n]+)/)?.[1] ?? 'no summary';
  const failed = [...out.matchAll(/FAIL\s+src\/serve\/hosted-harness-session\.test\.ts > ([^\n]+)/g)].map((m) => m[1]);
  return { tests, failed: [...new Set(failed)] };
}
function runJava() {
  const r = spawnSync('mvn', ['-B', '-o', '-q', `-Dmaven.repo.local=${S}/m2-head/repository`, '-Dgpg.skip=true', '-f', `${J}/pom.xml`, '-Dtest=QwenHostedHarnessConnectorTest,HarnessEventProjectorTest', '-Dsurefire.failIfNoSpecifiedTests=false', 'test'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = strip(r.stdout + r.stderr);
  const tests = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+)/g)].at(-1)?.slice(1).join('/') ?? (r.status === 0 ? 'ok' : 'no summary');
  const failed = [...out.matchAll(/(?:ERROR|FAIL)\]?\s+([A-Za-z]+Test\.[A-Za-z0-9_]+)/g)].map((m) => m[1]);
  return { tests: `exit=${r.status} run/fail/err=${tests}`, failed: [...new Set(failed)] };
}

const list = kind === 'ts' ? tsMutants : javaMutants;
const run = kind === 'ts' ? runTs : runJava;
const results = [];
const baseline = run();
console.log(`BASELINE ${JSON.stringify(baseline)}`);
results.push({ mutant: 'baseline (unmutated head)', ...baseline });
if (baseline.failed.length || !/4 passed/.test(baseline.tests)) { console.log('BASELINE NOT CLEAN, aborting'); process.exit(2); }
for (const [name, file, from, to] of list) {
  const original = apply(file, from, to);
  try {
    const r = run();
    console.log(`${name}: ${JSON.stringify(r)}`);
    results.push({ mutant: name, ...r });
  } finally {
    fs.writeFileSync(file, original);
  }
}
fs.writeFileSync(`${S}/rig/mutation-${kind}.json`, JSON.stringify(results, null, 2));
