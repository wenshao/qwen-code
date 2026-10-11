// Mutation runner for PR #13219 (src-mut worktree at bc1a436, committed).
// usage: node mut.mjs <java|ts> [ids...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const RIG = '/Users/wenshao/pr13219-rig';
const M = `${RIG}/src-mut`;
const J = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const C = 'packages/core/src/managed-runtime';
const JAVA_TESTS = 'AdmittedTurnRetryTerminalStateTest,OperationRetryTerminalStateTest,MessageMaterializerTest,MessageProjectionGapHealTest,ManagedActionStoreTest,HarnessCoordinatorTest,SessionLifecycleCoordinatorTest,ManagedSessionOperationStoreTest,SessionLifecycleServiceResumeTest,ManagedCwdChangeOperationTest,TaskCancelCoordinatorTest,ManagedOperationSchemaUpgradeTest';
const HHC = 'packages/sdk-java/qwencode/src/main/java/com/alibaba/qwen/code/daemon/HostedHarnessClient.java';
const V65 = 'packages/sdk-java/managed-agent-server/src/main/resources/db/migration/V68__managed_operation_budget_exempt.sql';
const STORE2 = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedAgentStore.java';
const MAT = `${J}/service/MessageMaterializer.java`;
const STORE = `${J}/store/ManagedAgentStore.java`;
const HC = `${J}/service/HarnessCoordinator.java`;
const SLC = `${J}/service/SessionLifecycleCoordinator.java`;
const MAS = `${J}/store/ManagedActionStore.java`;
const ARC = `${J}/service/ActionResponseCoordinator.java`;
const HTTP = `${C}/http-managed-session-store.ts`;
const ASM = `${C}/managed-session-assembly.ts`;
const ACT = `${C}/managed-activation-store.ts`;
const SCH = `${C}/embedded-harness-scheduler.ts`;

const mutants = [
  // ---- Java ----
  { id: 'J1', kind: 'java', file: MAT, what: 'backoff cap 60 s -> 600 s', find: 'MAX_BACKOFF_MS = 60_000;', rep: 'MAX_BACKOFF_MS = 600_000;' },
  { id: 'J2', kind: 'java', file: MAT, what: 'surface stuck projection on every failure past the budget', find: 'boolean surface = count >= STUCK_FAILURE_BUDGET && !surfaced;', rep: 'boolean surface = count >= STUCK_FAILURE_BUDGET;' },
  { id: 'J3', kind: 'java', file: MAT, what: 'never skip a backed-off session (scan-rate retries)', find: 'if (failure != null && now < failure.retryAfter()) {', rep: 'if (false) {' },
  { id: 'J4', kind: 'java', file: MAT, what: 'success does not reset the backoff', find: '                failures.remove(key);\n            } catch (RuntimeException error) {', rep: '            } catch (RuntimeException error) {' },
  { id: 'J5', kind: 'java', file: STORE, what: 'gap heal settles items of ACCEPTED/RUNNING turns too', find: "\" live.status IN ('ACCEPTED', 'RUNNING',\"", rep: "\" live.status IN ('NONE_X', 'NONE_Y',\"" },
  { id: 'J6', kind: 'java', file: STORE, what: 'gap heal ignores a terminal event already in the journal', find: "\" ('turn.completed', 'turn.failed',\"", rep: "\" ('none.x', 'none.y',\"" },
  { id: 'J7', kind: 'java', file: STORE, what: 'gap heal settles nothing', find: "\" = 'in_progress' AND last_sequence < ?\"", rep: "\" = 'never' AND last_sequence < ?\"" },
  { id: 'J8', kind: 'java', file: STORE, what: 'gap heal does not resync the expected sequence', find: 'expected = event.sequence() + 1;', rep: 'expected++;' },
  { id: 'J9', kind: 'java', file: HC, what: 'post-admission budget off by one (>)', find: "&& chargedFailures >= maxPostAdmissionRetries) {", rep: "&& chargedFailures > maxPostAdmissionRetries) {" },
  { id: 'J10', kind: 'java', file: HC, what: 'named refusal after admission records the generic code', find: "return fail(turn, true, refusal.getCode(),", rep: "return fail(turn, true, \"hosted_harness_unavailable_after_admission\"," },
  { id: 'J11', kind: 'java', file: HC, what: 'broker failure after admission records the generic code', find: "if (error instanceof RuntimeBrokerException brokerError) {\n                return fail(turn, true, brokerError.getCode(),", rep: "if (false && error instanceof RuntimeBrokerException brokerError) {\n                return fail(turn, true, brokerError.getCode()," },
  { id: 'J12', kind: 'java', file: HC, what: 'accept pre > post at startup', find: 'if (maxPostAdmissionRetries < maxPreAdmissionRetries) {', rep: 'if (false) {' },
  { id: 'J14', kind: 'java', file: SLC, what: 'terminate even when settle() already succeeded', find: "boolean settleReachedHarness = harnessSettled.get();", rep: "boolean settleReachedHarness = false;" },
  { id: 'J15', kind: 'java', file: SLC, what: 'terminal record drops the broker/blocked code', find: '                failureCode = brokerError.getCode();\n', rep: '' },
  { id: 'J16', kind: 'java', file: MAS, what: 're-admit on a non-ACTIVE Session', find: "                        && \"ACTIVE\".equals(replaySessionStatus)\n", rep: "" },
  { id: 'J17', kind: 'java', file: MAS, what: 're-admit although the Action already ended', find: '"requested".equals(action.get().state())', rep: 'true' },
  { id: 'J18', kind: 'java', file: MAS, what: 're-admit any FAILED response (e.g. 400 invalid_action_response)', find: "\"FAILED\".equals(existing.state())\n                    && (\"action_response_delivery_failed\"", rep: "\"FAILED\".equals(existing.state())\n                    && (true || \"action_response_delivery_failed\"" },
  { id: 'J19', kind: 'java', file: MAS, what: 'budget terminal claims HARNESS_CONFIRMED', find: 'harnessConfirmed ? "HARNESS_CONFIRMED" : "JAVA_DURABLE",', rep: '"HARNESS_CONFIRMED",' },
  { id: 'J20', kind: 'java', file: ARC, what: 'a committed-but-unprojected decision is recorded as a delivery failure', find: "harness.resolveAction(tenant, session, response.actionId(), response.body());\n                harnessAnswered = true;\n", rep: "harness.resolveAction(tenant, session, response.actionId(), response.body());\n" },
  { id: 'J21', kind: 'java', file: STORE, what: 'failOperation leaves the row re-drivable (delivery PENDING)', find: "\" state = 'FAILED', delivery_state = 'CONFIRMED',\"", rep: "\" state = 'FAILED', delivery_state = 'PENDING',\"" },
  { id: 'J22', kind: 'java', file: STORE, what: 'failOperation ignores the claim fence', find: "\" AND lease_owner = ? AND claim_generation = ?\"\n                        + \" AND lease_until > ?\",\n                failureCode,", rep: "\" AND lease_owner = lease_owner AND claim_generation = claim_generation AND ? IS NOT NULL AND ? IS NOT NULL\"\n                        + \" AND lease_until > ?\",\n                failureCode," },
  // ---- Java, round 2 (new guards) ----
  { id: 'N1', kind: 'java', file: SLC, what: 'stale-boot generation error is charged and can terminate', find: '                    && !staleBoot) {', rep: '                    ) {' },
  { id: 'N2', kind: 'java', file: SLC, what: 'writer wait exempts non-retryable refusals too (R1-30 revert)', find: 'boolean exemptWait = writerLive && retryable(cause);', rep: 'boolean exemptWait = writerLive;' },
  { id: 'N3', kind: 'java', file: SLC, what: 'operation budget ignores the exempt watermark', find: 'claimed.attemptCount() - claimed.budgetExemptAttempt();', rep: 'claimed.attemptCount();' },
  { id: 'N4', kind: 'java', file: SLC, what: 'settled-completion budget factor 4 -> 1', find: 'SETTLED_COMPLETION_BUDGET_FACTOR = 4;', rep: 'SETTLED_COMPLETION_BUDGET_FACTOR = 1;' },
  { id: 'N5', kind: 'java', file: SLC, what: 'terminate and release under a live writer (no published wait)', find: '                if (writerLive) {', rep: '                if (false) {' },
  { id: 'N6', kind: 'java', file: HC, what: 'turn budget ignores exempt failures', find: 'current.consecutiveFailures() - current.budgetExemptFailures();', rep: 'current.consecutiveFailures();' },
  { id: 'N7', kind: 'java', file: HC, what: 'recovery-in-progress 409 no longer exempt', find: '                                || "hosted_turn_recovery_in_progress"\n                                        .equals(errorCode));', rep: '                                );' },
  { id: 'N8', kind: 'java', file: HC, what: 'no cancel before a post-admission terminal', find: '            cancelAdmittedTurnBeforeTerminalFail(turn);\n', rep: '' },
  { id: 'N9', kind: 'java', file: ARC, what: 'answered latch forgotten across attempts', find: 'boolean answered = harnessAnswered || op.budgetExemptAttempt() > 0;', rep: 'boolean answered = harnessAnswered;' },
  { id: 'N10', kind: 'java', file: ARC, what: 'answered-but-expired decision never terminates', find: 'if (answered && decisionExpired(tenant, session, current.actionId())) {', rep: 'if (false) {' },
  { id: 'N11', kind: 'java', file: STORE2, what: 'journaled progress does not reset consecutive_failures (admission)', find: "        // growing across a crash loop that keeps making progress (review\n        // round 8, R8-3).\n        int updated = jdbc.update(\"UPDATE managed_agent_turn SET status =\"\n                        + \" CASE WHEN status = 'CANCELLING' THEN status ELSE\"\n                        + \" 'RUNNING' END, harness_event_epoch = ?,\"\n                        + \" harness_last_event_id = ?, consecutive_failures = 0,\"\n                        + \" budget_exempt_failures = 0,\"\n", rep: "        // growing across a crash loop that keeps making progress (review\n        // round 8, R8-3).\n        int updated = jdbc.update(\"UPDATE managed_agent_turn SET status =\"\n                        + \" CASE WHEN status = 'CANCELLING' THEN status ELSE\"\n                        + \" 'RUNNING' END, harness_event_epoch = ?,\"\n                        + \" harness_last_event_id = ?,\"\n" },
  { id: 'N12', kind: 'java', file: V65, what: 'V65 backfill skips RUNNING rows', find: "AND state IN ('PENDING', 'RUNNING', 'RECOVERY_BLOCKED');", rep: "AND state IN ('PENDING', 'RECOVERY_BLOCKED');" },
  { id: 'N13', kind: 'java', file: STORE2, what: 'journaled events do not reset consecutive_failures', find: "        return jdbc.update(\"UPDATE managed_agent_turn SET\"\n                        + \" harness_event_epoch = ?,\"\n                        + \" harness_last_event_id = ?, consecutive_failures = 0,\"", rep: "        return jdbc.update(\"UPDATE managed_agent_turn SET\"\n                        + \" harness_event_epoch = ?,\"\n                        + \" harness_last_event_id = ?,\"" },
  // ---- qwencode (F1 fix) ----
  { id: 'F1a', kind: 'sdk', file: HHC, what: 'no /status probe (original F1)', find: '            try {\n                getStatus(session);\n            } catch (HostedHarnessGenerationException generationChange) {\n                throw generationChange;\n            } catch (DaemonException probeFailure) {\n                throw new DaemonException(\n                        "Hosted Harness session already has a running turn");\n            }\n', rep: '' },
  { id: 'F1b', kind: 'sdk', file: HHC, what: 'probe failure leaks its own exception type', find: '            } catch (DaemonException probeFailure) {\n                throw new DaemonException(\n                        "Hosted Harness session already has a running turn");\n            }\n', rep: '            }\n' },
  { id: 'F1c', kind: 'sdk', file: HHC, what: 'generation change flattened into a busy retry', find: '            } catch (HostedHarnessGenerationException generationChange) {\n                throw generationChange;\n            } catch (DaemonException probeFailure) {', rep: '            } catch (DaemonException probeFailure) {' },
  // ---- TS ----
  { id: 'T6', kind: 'ts', file: ASM, test: 'src/managed-runtime/managed-session-assembly.test.ts', what: 'seal only after a successful release (no finally)', find: '      } finally {\n        await authority.close();\n      }', rep: '      }\n      await authority.close();' },
  { id: 'T7', kind: 'ts', file: ACT, test: 'src/managed-runtime/managed-activation-store.test.ts', what: 'failed append is not repaired (torn tail stays)', find: '        await truncate(this.filePath, this.syncedBytes);\n', rep: '' },
  { id: 'T8', kind: 'ts', file: ACT, test: 'src/managed-runtime/managed-activation-store.test.ts', what: 'synced length never advances', find: '    this.syncedBytes += line.byteLength;\n', rep: '' },
  { id: 'T9', kind: 'ts', file: ACT, test: 'src/managed-runtime/managed-activation-store.test.ts', what: 'first-write ENOENT repair treated as fatal', find: '          this.syncedBytes !== 0\n', rep: '          true\n' },
  { id: 'T10', kind: 'ts', file: SCH, test: 'src/managed-runtime/embedded-harness-scheduler.test.ts', what: 'transient-streak halt disabled', find: "const MAX_TRANSIENT_STORE_FAILURES_PER_SLOT = 10;", rep: "const MAX_TRANSIENT_STORE_FAILURES_PER_SLOT = 1_000_000;" },
  { id: 'T11', kind: 'ts', file: SCH, test: 'src/managed-runtime/embedded-harness-scheduler.test.ts', what: 'per-activation budget disabled', find: 'const MAX_ACTIVATION_TRANSIENT_FAILURES = 3;', rep: 'const MAX_ACTIVATION_TRANSIENT_FAILURES = 1_000_000;' },
  { id: 'T12', kind: 'ts', file: SCH, test: 'src/managed-runtime/embedded-harness-scheduler.test.ts', what: 'memory-blocked pump arms no recheck wake', find: "        this.armBlockedWake();\n        return;\n      }\n      this.clearMemoryBlocked();", rep: "        return;\n      }\n      this.clearMemoryBlocked();" },
  { id: 'T13', kind: 'ts', file: SCH, test: 'src/managed-runtime/embedded-harness-scheduler.test.ts', what: 'single release attempt', find: 'const MAX_RELEASE_ATTEMPTS = 3;', rep: 'const MAX_RELEASE_ATTEMPTS = 1;' },
];

const [kind, ...ids] = process.argv.slice(2);
if (kind === 'check') {
  for (const m of mutants) { let t = ''; try { t = fs.readFileSync(`${M}/${m.file}`, 'utf8'); } catch { console.log(m.id, 'NOFILE'); continue; } const n = t.split(m.find).length - 1; if (n !== 1) console.log(m.id, `count=${n}`, m.what); }
  console.log('checked', mutants.length);
  process.exit(0);
}
const selected = mutants.filter((m) => m.kind === kind && (ids.length === 0 || ids.includes(m.id)));
const out = `${RIG}/out/mut-r2-${kind}.tsv`;

function runJava(label) {
  const t = Date.now();
  const r = spawnSync('/Users/wenshao/Install/maven/bin/mvn', ['-o', '-B', '-ntp', '-q', `-Dmaven.repo.local=${RIG}/m2-head`, 'test', `-Dtest=${JAVA_TESTS}`, '-Dsurefire.failIfNoSpecifiedTests=false', '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', '-Djacoco.skip=true'], { cwd: `${M}/packages/sdk-java/managed-agent-server`, encoding: 'utf8', env: { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` }, maxBuffer: 256 * 1024 * 1024 });
  const text = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(`${RIG}/out/mut-${label}.log`, text);
  const failed = [...new Set([...text.matchAll(/\[ERROR\]\s+([A-Za-z]+Test)\.([A-Za-z0-9_]+)/g)].map((m) => `${m[1]}.${m[2]}`))];
  const compileError = /COMPILATION ERROR/.test(text);
  return { pass: r.status === 0, failed, compileError, secs: Math.round((Date.now() - t) / 1000) };
}
function runSdk(label) {
  const t = Date.now();
  const r = spawnSync('/Users/wenshao/Install/maven/bin/mvn', ['-o', '-B', '-ntp', '-q', `-Dmaven.repo.local=${RIG}/m2-head`, 'test', '-Dgpg.skip=true', '-Dtest=HostedHarnessClientTest', '-Dsurefire.failIfNoSpecifiedTests=false'], { cwd: `${M}/packages/sdk-java/qwencode`, encoding: 'utf8', env: { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` }, maxBuffer: 256 * 1024 * 1024 });
  const text = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(`${RIG}/out/mut-${label}.log`, text);
  const failed = [...new Set([...text.matchAll(/\[ERROR\]\s+([A-Za-z]+Test)\.([A-Za-z0-9_]+)/g)].map((m) => `${m[1]}.${m[2]}`))];
  return { pass: r.status === 0, failed, compileError: /COMPILATION ERROR/.test(text), secs: Math.round((Date.now() - t) / 1000) };
}
function runTs(label, test) {
  const t = Date.now();
  const r = spawnSync('npx', ['vitest', 'run', test], { cwd: `${M}/packages/core`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const text = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(`${RIG}/out/mut-${label}.log`, text);
  const failed = [...new Set([...text.matchAll(/(?:FAIL|×)\s+([^\n]*?)(?:\s+\d+ms)?\n/g)].map((m) => m[1].trim()).filter((s) => s && !/^src\/.*\.ts$/.test(s)))].slice(0, 6);
  const summary = text.match(/^\s*Tests\s+[^\n]*/m)?.[0]?.trim();
  return { pass: r.status === 0, failed, summary, secs: Math.round((Date.now() - t) / 1000) };
}

if (spawnSync('git', ['-C', M, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).stdout.trim()) {
  console.error('src-mut is dirty; refusing');
  process.exit(2);
}
fs.appendFileSync(out, `# ${new Date().toISOString()} ${kind} ${ids.join(',')}\n`);
if (kind === 'sdk') {
  const b = runSdk('sdk-baseline');
  console.log(`baseline sdk pass=${b.pass} ${b.secs}s failed=${b.failed.join(',')}`);
  fs.appendFileSync(out, `baseline\t${b.pass}\t${b.failed.join(',')}\n`);
  if (!b.pass) process.exit(3);
} else if (kind === 'java') {
  const b = runJava('java-baseline');
  console.log(`baseline java pass=${b.pass} ${b.secs}s failed=${b.failed.join(',')}`);
  fs.appendFileSync(out, `baseline\t${b.pass}\t${b.failed.join(',')}\n`);
  if (!b.pass) process.exit(3);
} else {
  for (const test of [...new Set(selected.map((m) => m.test))]) {
    const b = runTs(`ts-baseline-${test.split('/').pop()}`, test);
    console.log(`baseline ${test} pass=${b.pass} ${b.summary} ${b.secs}s`);
    fs.appendFileSync(out, `baseline\t${test}\t${b.pass}\t${b.summary}\n`);
    if (!b.pass) process.exit(3);
  }
}
for (const m of selected) {
  const path = `${M}/${m.file}`;
  const src = fs.readFileSync(path, 'utf8');
  const count = src.split(m.find).length - 1;
  if (count !== 1) { console.log(`${m.id} ANCHOR count=${count}`); fs.appendFileSync(out, `${m.id}\tANCHOR\t${count}\n`); continue; }
  fs.writeFileSync(path, src.replace(m.find, m.rep));
  let r;
  try {
    r = m.kind === 'java' ? runJava(m.id) : m.kind === 'sdk' ? runSdk(m.id) : runTs(m.id, m.test);
  } finally {
    spawnSync('git', ['-C', M, 'checkout', '--', m.file]);
  }
  const verdict = r.compileError ? 'COMPILE-ERROR' : r.pass ? 'SURVIVED' : 'KILLED';
  console.log(`${m.id}\t${verdict}\t${r.secs}s\t${m.what}\t${(r.failed ?? []).slice(0, 4).join(' | ')}`);
  fs.appendFileSync(out, `${m.id}\t${verdict}\t${m.what}\t${(r.failed ?? []).slice(0, 6).join(' | ')}\n`);
}
const dirty = spawnSync('git', ['-C', M, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).stdout.trim();
console.log(dirty ? `DIRTY AFTER RUN:\n${dirty}` : 'tree clean');
