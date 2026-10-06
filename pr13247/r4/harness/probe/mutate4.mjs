// VERIFICATION RIG ONLY (PR #13247): line-anchored mutants of the W2 guards, each run against the PR's focused tests.
// usage: MUT_TREE=<worktree at PR head> MUT_M2=<maven repo> node mutate.mjs [ids...]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TREE = process.env.MUT_TREE;
const M2 = process.env.MUT_M2;
if (!TREE || !M2) { console.error('MUT_TREE and MUT_M2 are required'); process.exit(2); }
const MOD = `${TREE}/packages/sdk-java/managed-agent-server`;
const SRC = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent`;
const STORE = `${SRC}/store/ManagedAgentStore.java`;
const RES = `${SRC}/service/WorkspaceRuntimeResolver.java`;
const SVC = `${SRC}/service/SessionLifecycleService.java`;
const CO = `${SRC}/service/SessionLifecycleCoordinator.java`;
const TESTS = process.env.MUT_TESTS ?? 'ManagedCwdChangeOperationTest,WorkspaceRuntimeInstallProbeTest,WorkspaceRuntimeResolutionPivotTest,ManagedAgentApiContractTest,ManagedOperationSchemaUpgradeTest,ManagedCwdOperationContractShapeTest,WorkspaceRuntimeTest';
const LEDGER = process.env.MUT_LEDGER ?? '/Users/wenshao/pr13247-rig/r4/mutation/ledger.jsonl';

// [id, description, [[file, line, from, to], ...]]
const MUTANTS = [
  ["R1", "probe: vanished mount root retries instead of terminal", [[RES, 135, "catch (java.nio.file.NoSuchFileException error) {", "catch (java.nio.file.FileSystemLoopException error) {"]]],
  ["R2", "probe: vanished target retries instead of terminal", [[RES, 191, "} catch (java.nio.file.NoSuchFileException", "} catch (java.nio.file.FileSystemLoopException"]]],
  ["R3", "probe: permission denial retries instead of terminal", [[RES, 192, "| java.nio.file.AccessDeniedException | SecurityException", "| SecurityException"]]],
  ["R4", "probe: ENOTDIR/ELOOP ancestors retry (no ancestor walk)", [[RES, 196, "throw hasStructuralAncestor(base, directory)", "throw false"]]],
  ["R5a", "probe: drop the READ access check", [[RES, 189, "java.nio.file.AccessMode.READ,", ""]]],
  ["R5b", "probe: drop the EXECUTE access check", [[RES, 190, "java.nio.file.AccessMode.EXECUTE);", "java.nio.file.AccessMode.READ);"]]],
  ["R6", "acquire: drop the readability check (F1 on the turn path)", [[RES, 156, "|| !Files.isReadable(directory)", "|| false"]]],
  ["R7", "acquire: drop the search check", [[RES, 157, "|| !Files.isExecutable(directory)) {", "|| false) {"]]],
  ["R8", "acquire: I/O anomaly becomes retryable (R6 regression)", [[RES, 164, "throw WorkspaceExecutionStore.unavailable();", "throw WorkspaceExecutionStore.unavailableTransient(error);"]]],
  ["R9", "coordinator: no attempt budget (unbounded retry)", [[CO, 208, ">= CWD_CHANGE_ATTEMPT_BUDGET) {", ">= Integer.MAX_VALUE) {"]]],
  ["R10", "coordinator: budget off by one (9 probes)", [[CO, 207, "if (operation.attemptCount() + 1", "if (operation.attemptCount()"]]],
  ["R11", "coordinator: a retryable refusal fails terminally (old N12)", [[CO, 206, "if (error.isRetryable()) {", "if (false) {"]]],
  ["R12", "admission: ignore a requested Action (old N5)", [[STORE, 894, "|| hasDecidableAction(session)) {", "|| false) {"]]],
  ["R13", "later-Turn handshake off (old N3)", [[STORE, 490, "&& hasOpenExecutionOperation(tenantId, sessionId)) {", "&& false) {"]]],
  ["R14", "settlement: ignore a requested Action (old N6)", [[STORE, 955, "|| hasDecidableAction(session)) {", "|| false) {"]]],
];

const want = process.argv.slice(2);
const run = (args, opts = {}) => spawnSync('mvn', ['-B', '-ntp', '-o', `-Dmaven.repo.local=${M2}`, ...args], { cwd: MOD, encoding: 'utf8', env: { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}`, TZ: 'UTC' }, maxBuffer: 1 << 28, ...opts });
fs.mkdirSync(LEDGER.replace(/\/[^/]+$/, ''), { recursive: true });
for (const [id, desc, edits] of MUTANTS) {
  if (want.length && !want.includes(id)) continue;
  const originals = new Map();
  let ok = true;
  for (const [file, line, from, to] of edits) {
    if (!originals.has(file)) originals.set(file, fs.readFileSync(file, 'utf8'));
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let idx = line - 1;
    if (line === 0) { const hits = lines.map((l, i) => (l.includes(from) ? i : -1)).filter((i) => i >= 0); if (hits.length !== 1) { ok = false; break; } idx = hits[0]; }
    if (!lines[idx]?.includes(from)) { console.error(`${id}: anchor not found at ${file}:${line}`); ok = false; break; }
    lines[idx] = lines[idx].replace(from, to);
    fs.writeFileSync(file, lines.join('\n'));
  }
  let verdict = 'ANCHOR_MISSING', detail = '';
  const t0 = Date.now();
  if (ok) {
    const r = run(process.env.MUT_ARGS ? JSON.parse(process.env.MUT_ARGS) : ['-Dcheckstyle.skip', `-Dtest=${TESTS}`, '-Dsurefire.failIfNoSpecifiedTests=false', 'test']);
    const out = r.stdout + r.stderr;
    fs.writeFileSync(`${LEDGER.replace(/\/[^/]+$/, '')}/${id}${process.env.MUT_SUFFIX ?? ''}.log`, out);
    if (/COMPILATION ERROR/.test(out)) verdict = 'COMPILE_ERROR';
    else if (r.status === 0 && !/Tests run: [1-9]/.test(out)) verdict = 'NO_TESTS_RAN';
    else if (r.status === 0) verdict = 'SURVIVED';
    else {
      verdict = 'KILLED';
      detail = [...out.matchAll(/\[ERROR\]\s+(\S+Test\.\w+)(?::\d+)?\s/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6).join(', ');
    }
    const tally = out.match(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/m);
    if (tally) detail += ` [run ${tally[1]} fail ${tally[2]} err ${tally[3]}]`;
  }
  for (const [file, text] of originals) fs.writeFileSync(file, text);
  const rec = { id, suite: process.env.MUT_SUFFIX ?? 'focused', desc, verdict, detail, s: Math.round((Date.now() - t0) / 1000) };
  fs.appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
  console.log(`${id} ${verdict} ${desc} ${detail}`);
}
const dirty = spawnSync('git', ['-C', TREE, 'status', '--porcelain', '--', 'packages/sdk-java/managed-agent-server/src/main'], { encoding: 'utf8' }).stdout.trim();
console.log(dirty ? `TREE DIRTY:\n${dirty}` : 'tree clean');
