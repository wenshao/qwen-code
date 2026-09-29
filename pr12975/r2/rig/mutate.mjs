// Mutation sweep of PR #12975's production changes. Each mutant is one
// exact string replacement in the PR head copy (wt-mut); the targeted test
// classes run, the file is restored, and the verdict is recorded.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad';
const MOD = process.env.MOD;
const SRC = `${MOD}/src/main/java/com/alibaba/qwen/code/runtimebroker`;
const OUT = process.env.OUT;
const TESTS = 'BrokerValuesTest,HttpRuntimeTransportTest,RuntimeBrokerServiceTest,ManagedContextRecoveryTest,RuntimeBrokerHttpServerTest';

const H = 'HttpRuntimeTransport.java';
const V = 'BrokerValues.java';
const S = 'RuntimeBrokerService.java';
const MUTANTS = [
  ['M01 install: drop the Session-state check', H, 'if (!sessionRecord.isAcquirable()) {', 'if (false) {'],
  ['M02 install: READY only (no ACQUIRING)', H, 'if (!sessionRecord.isAcquirable()) {', 'if (sessionRecord.getState() != RuntimeSessionRecord.State.READY) {'],
  ['M03 install: drop the drain check', H, '|| runtime.isDrainRequested()', ''],
  ['M04 transport: tool name unchecked', H, `return BrokerValues.requireWellFormed(
                referenceString(reference, "toolName"), "reference toolName");`, 'return referenceString(reference, "toolName");'],
  ['M05 transport: tool input unchecked', H, 'if (!BrokerValues.isWellFormedJson(input)) {', 'if (false) {'],
  ['M06 values: map keys unchecked', V, `|| !isWellFormed(key)
`, `
`],
  ['M07 values: list items unchecked', V, `            for (Object item : list) {
                if (!isWellFormedJson(item)) {`, `            for (Object item : list) {
                if (false) {`],
  ['M08 values: any object accepted (fail open)', V, `return value == null || value instanceof Number
                || value instanceof Boolean;`, 'return true;'],
  ['M09 values: high surrogates only', V, `point >= Character.MIN_SURROGATE
                        && point <= Character.MAX_SURROGATE);`, `point >= Character.MIN_HIGH_SURROGATE
                        && point <= Character.MAX_HIGH_SURROGATE);`],
  ['M10 start: drop the raw-text check', S, 'if (payloadJson == null || !BrokerValues.isWellFormedJson(payloadJson)) {', 'if (payloadJson == null) {'],
  ['M11 start: drop the parsed-payload check', S, `                    || !BrokerValues.isWellFormedJson(payload)
`, ''],
  ['M12 create: drop the reference check', S, `            if (!BrokerValues.isWellFormedJson(safeReference)) {
                throw invalid("runtime_reference_invalid",`, `            if (false) {
                throw invalid("runtime_reference_invalid",`],
  ['M13 deadline: legacy also reads the failure', S, `RuntimeBrokerException failure = request.isManagedContext()
                        ? nonRetryable.get() : null;`, 'RuntimeBrokerException failure = nonRetryable.get();'],
  ['M14 deadline: 409 even after a non-retryable failure', S, 'operation.completeExceptionally(blocked && failure == null', 'operation.completeExceptionally(blocked'],
  ['M15 deadline: no suppressed repository failure', S, '&& blockRecoveryQuietly(timedOut, answer);', '&& blockRecoveryQuietly(timedOut, new RuntimeException("discarded"));'],
  ['M16 handler: never publishes the failure', S, `                        nonRetryable.set(failure);
`, `
`],
  ['M17 handler: publishes after taking the claim', S, `                    if (cause instanceof RuntimeBrokerException failure
                            && !failure.isRetryable()) {
                        nonRetryable.set(failure);
                    }
                    RuntimeBindingRecord currentClaim = renewal.stopAndGet();`, `                    RuntimeBindingRecord currentClaim = renewal.stopAndGet();
                    if (cause instanceof RuntimeBrokerException failure
                            && !failure.isRetryable()) {
                        nonRetryable.set(failure);
                    }`],
  ['M18 deadline: reads the failure when it finishes, not when it fires', S, `                    operation.completeExceptionally(blocked && failure == null
                            ? conflict("runtime_broker_recovery_blocked",
                                    "Managed Runtime recovery is blocked.")
                            : answer);`, `                    RuntimeBrokerException late = request.isManagedContext() ? nonRetryable.get() : null;
                    operation.completeExceptionally(blocked && late == null
                            ? conflict("runtime_broker_recovery_blocked",
                                    "Managed Runtime recovery is blocked.")
                            : late != null ? late : answer);`],
  ['M19 block helper: drop addSuppressed', S, `            cause.addSuppressed(failure);
            return false;`, `            return false;`],
  ['M20 start: raw surrogate back to the old uncoded refusal', S, 'if (payloadJson == null || !BrokerValues.isWellFormedJson(payloadJson)) {', 'if (payloadJson == null || BrokerValues.requireWellFormed(payloadJson, "payloadJson") == null) {'],
  ['M21 handler: retryable flag diverges from the publish guard (review R1-4 witness)', S, `boolean retryable = !(cause instanceof RuntimeBrokerException
                                    brokerFailure) || brokerFailure.isRetryable();`, `boolean retryable = cause instanceof RuntimeBrokerException
                                    brokerFailure && brokerFailure.isRetryable();`],
];

const only = process.env.ONLY?.split(',');
for (const [name, file, from, to] of MUTANTS) {
  if (only && !only.some((id) => name.startsWith(id))) continue;
  const target = path.join(SRC, file);
  const original = fs.readFileSync(target, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== 1) {
    fs.appendFileSync(OUT, JSON.stringify({ name, error: `pattern matched ${count} times` }) + '\n');
    console.log(name, `pattern matched ${count} times`);
    continue;
  }
  fs.writeFileSync(target, original.replace(from, to));
  const t0 = Date.now();
  const run = spawnSync('mvn', ['--batch-mode', '--no-transfer-progress', '-o', `-Dmaven.repo.local=${SP}/m2`,
    `-Dtest=${TESTS}`, 'test'], { cwd: MOD, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(target, original);
  const log = run.stdout + run.stderr;
  const compileError = /COMPILATION ERROR/.test(log);
  const failures = [...log.matchAll(/^\[ERROR\]   ([A-Za-z]+Test)\.([A-Za-z]+)/gm)].map((m) => `${m[1]}.${m[2]}`);
  const summary = log.match(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/m)?.[0] ?? '';
  const verdict = compileError ? 'COMPILE-ERROR' : run.status === 0 ? 'SURVIVED' : 'KILLED';
  const row = { name, verdict, seconds: Math.round((Date.now() - t0) / 1000), summary, killers: [...new Set(failures)] };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  fs.writeFileSync(`${path.dirname(OUT)}/${name.slice(0, 3)}.log`, log);
  console.log(name, verdict, row.killers.join(' '));
}
execFileSync('git', ['-C', path.resolve(MOD, '../../..'), 'diff', '--stat'], { stdio: 'inherit' });
