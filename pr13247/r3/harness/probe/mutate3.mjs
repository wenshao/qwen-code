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
const LEDGER = process.env.MUT_LEDGER ?? '/Users/wenshao/pr13247-rig/r2/mutation/ledger.jsonl';

// [id, description, [[file, line, from, to], ...]]
const MUTANTS = [
  ['N1', 'shared rule: drop the readability check', [[RES, 131, '|| !Files.isReadable(directory) || !Files.isExecutable(directory)) {', '|| !Files.isExecutable(directory)) {']]],
  ['N2', 'shared rule: drop the search (x) check', [[RES, 131, '|| !Files.isReadable(directory) || !Files.isExecutable(directory)) {', '|| !Files.isReadable(directory)) {']]],
  ['N3', 'later-Turn handshake: never consult open operations', [[STORE, 468, '&& hasOpenExecutionOperation(tenantId, sessionId)) {', '&& false) {']]],
  ['N4', 'handshake barrier also counts ACTION_RESPONSE rows', [[STORE, 1028, '+ " \'ACTION_RESPONSE\' AND state IN (\'PENDING\',"', '+ " \'NO_SUCH_KIND\' AND state IN (\'PENDING\',"']]],
  ['N5', 'admission: ignore a requested Action', [[STORE, 863, '|| hasDecidableAction(session)) {', '|| false) {']]],
  ['N6', 'settlement: ignore a requested Action', [[STORE, 916, '|| hasDecidableAction(session)) {', '|| false) {']]],
  ['N7', 'opt-in gate before the replay again (R2-1 reverted)', [[STORE, 815, 'requireCwdChangeActor(session, actorId);', 'requireCwdChangeActor(session, actorId); if (!workspaceFilesEnabled) { throw workspaceExecutionUnavailable(); }']]],
  ['N8', 'actor check after the opt-in gate (stranger sees 409 again)', [[STORE, 815, 'requireCwdChangeActor(session, actorId);', 'if (!workspaceFilesEnabled) { throw workspaceExecutionUnavailable(); } requireCwdChangeActor(session, actorId);']]],
  ['N9', 'probe verifies the CURRENT binding, not the candidate (R2-2 reverted)', [[RES, 101, 'WorkspaceRelativePath.normalize(targetCwdRelative),', 'binding.getCwdRelative(),']]],
  ['N10', 'requireDirectory I/O failure is structural, not transient', [[RES, 135, 'throw WorkspaceExecutionStore.unavailableTransient(error);', 'throw WorkspaceExecutionStore.unavailable();']]],
  ['N11', 'mount-continuity I/O failure is structural, not transient', [[RES, 118, 'throw WorkspaceExecutionStore.unavailableTransient(error);', 'throw WorkspaceExecutionStore.unavailable();']]],
  ['N12', 'coordinator: a transient refusal fails terminally', [[CO, 191, 'if (error.isRetryable()) {', 'if (false) {']]],
  ['N13', 'coordinator: every refusal retries', [[CO, 191, 'if (error.isRetryable()) {', 'if (true) {']]],
  ['N14', 'settlement: detached binding reported as revision conflict', [[STORE, 911, 'failure = "workspace_unavailable";', 'failure = "context_revision_conflict";']]],
  ['M1', 'admission: drop the open-operation barrier', [[STORE, 853, 'if (hasOpenOperation(tenantId, sessionId)', 'if (false']]],
  ['M2', 'admission: drop the active-Turn barrier', [[STORE, 854, '|| hasActiveTurn(tenantId, sessionId)', '|| false']]],
  ['M3', 'admission: skip the revision CAS', [[STORE, 845, 'binding.getContextRevision() != expectedContextRevision', 'false']]],
  ['M4', 'admission: skip the creator check', [[STORE, 815, 'requireCwdChangeActor(session, actorId);', '']]],
  ['M5', 'admission: skip the Registry-facts check', [[STORE, 844, 'requireCwdChangeRegistryFacts(session);', '']]],
  ['M6', 'admission: never raise idempotency_conflict', [[STORE, 827, '!existing.get().requestDigest().equals(requestDigest)', 'false']]],
  ['M7', 'commit: skip the revision re-check', [[STORE, 912, '} else if (binding.getContextRevision() != expected) {', '} else if (false) {']]],
  ['M8', 'commit: skip the busy re-check', [[STORE, 914, 'hasOpenOperation(tenantId, sessionId, operationId)', '(false)'], [STORE, 915, '|| hasActiveTurn(tenantId, sessionId)', '|| false']]],
  ['M9', 'commit: skip the Registry/grant re-check', [[STORE, 918, '!hasCwdChangeRegistryFacts(session)', 'false']]],
  ['M10', 'commit: ignore the lease/owner/generation guard', [[STORE, 903, 'return null;', ';']]],
  ['M11', 'accept aliases (no realpath identity)', [[RES, 130, '|| !directory.toRealPath().equals(directory)', '|| !directory.toRealPath().equals(directory.toRealPath())']]],
  ['M13', 'probe: skip the mount continuity check', [[RES, 94, 'verifyMountIntact(mount);', '']]],
  ['M14', 'probe: skip the directory rule entirely', [[RES, 95, 'requireDirectory(mount.root().toString(), targetCwdRelative);', '']]],
  ['M15', 'digest over the raw spelling', [[SVC, 0, '"cwdRelative", normalized,', '"cwdRelative", cwdRelative,']]],
  ['M16', 'commit: no session.context.changed event', [[STORE, 953, 'appendEvent(tenantId, sessionId, null, "session.context.changed",', 'if (false) appendEvent(tenantId, sessionId, null, "session.context.changed",']]],
  ['M18b', 'upgrade: drop the additive-column tolerance', [[STORE, 2775, 'return hasColumn(result, name) ? result.getString(name) : null;', 'return result.getString(name);'], [STORE, 2780, 'return hasColumn(result, name) ? nullableLong(result, name) : null;', 'return nullableLong(result, name);']]],
  ['M21', 'commit: write revision expected+2', [[STORE, 931, 'long result = expected + 1;', 'long result = expected + 2;']]],
  ['M22', 'admission: skip the ACTIVE status gate', [[STORE, 841, 'if (!"ACTIVE".equals(session.status())) {', 'if (false) {']]],
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
