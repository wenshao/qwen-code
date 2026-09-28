// Targeted mutants against the PR's own suites, in a separate worktree.
// Each mutant is one exact replacement; the suite verdict is the exit code
// (killed = the suite fails), and the source is restored with git after each.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad';
const WT = `${SP}/wt-mut6`;
const J = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const T = 'packages/core/src/managed-runtime';
const MUTANTS = [
  { id: 'J6', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'apply: drop the recordRef byteLength match',
    old: '&& resource.byteLength() == recordRef.get("byteLength")\n                        .longValue()', neu: '&& (resource.byteLength() >= 0 || recordRef.get("byteLength")\n                        .longValue() == 0)' },
  { id: 'J7', lang: 'java', file: `${J}/service/ManagedTaskService.java`, what: 'list: accept limit up to 1000',
    old: 'if (limit < 1 || limit > 100) {', neu: 'if (limit < 1 || limit > 1000) {' },
  { id: 'J8', lang: 'java', file: `${J}/service/ManagedTaskService.java`, what: 'list: build next_cursor from the first row of the page',
    old: 'TaskRow last = page.tasks().get(page.tasks().size() - 1);', neu: 'TaskRow last = page.tasks().get(0);' },
  { id: 'J11', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'announce: dedupe key without the revision',
    old: '"task:" + taskId + ":" + revision);', neu: '"task:" + taskId);' },
  { id: 'J12', lang: 'java', file: `${J}/store/ManagedExtensionProjection.java`, what: 'projection: drop the started_at clamp to created_at',
    old: '? Long.valueOf(Math.max(occurredAt, createdAt)) : null;', neu: '? Long.valueOf(occurredAt) : null;' },
  { id: 'J13', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'parse: accept trailing content after a JSON line',
    old: '.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();', neu: '.build();' },
  { id: 'J14', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'envelope: drop the closed-payload check',
    old: 'ManagedExtensionRecords.closed(payload, PAYLOAD_FIELDS,\n                    "event.payload");', neu: 'assert PAYLOAD_FIELDS != null;' },
  { id: 'J15', lang: 'java', file: `${J}/store/ManagedExtensionProjection.java`, what: 'projection: recovery_blocked sets started_at again',
    old: 'STARTED = Set.of("running", "waiting",\n            "settled");', neu: 'STARTED = Set.of("running", "waiting",\n            "recovery_blocked", "settled");' },
  { id: 'T1', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'taskViews: ascending task ID on a createdAt tie',
    old: ': left.taskId < right.taskId\n            ? 1\n            : -1,', neu: ': left.taskId < right.taskId\n            ? -1\n            : 1,' },
  { id: 'T4', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'rebuild: accept a revision that no longer chains',
    old: 'throw new ManagedSessionRecordError(\n            `session log is corrupt: ${message}`,\n          );', neu: 'void message;' },
  { id: 'T12', lang: 'ts', file: `${T}/managed-extension-projection.ts`, what: 'projection: drop the started_at clamp to createdAt',
    old: '(STARTED.includes(run.state) ? Math.max(occurredAt, createdAt) : null);', neu: '(STARTED.includes(run.state) ? occurredAt : null);' },
  { id: 'T15', lang: 'ts', file: `${T}/managed-extension-projection.ts`, what: 'projection: recovery_blocked sets startedAt again',
    old: "const STARTED: readonly ExtensionRunState[] = ['running', 'waiting', 'settled'];", neu: "const STARTED: readonly ExtensionRunState[] = ['running', 'waiting', 'recovery_blocked', 'settled'];" },
  { id: 'T16', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'authority: one command may open a second Stage H record',
    old: 'if (record.operationId === operationId) {', neu: 'if (false) {' },
  { id: 'J16', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'store: one command may open a second record',
    old: 'require(opened != null && opened == 0, "Command "', neu: 'require(opened != null, "Command "' },
  { id: 'J17', lang: 'java', file: `${J}/store/ManagedAgentStore.java`, what: 'announce: a DELETED Session still gets task.updated',
    old: '|| "DELETED".equals(session.get().status())) {', neu: ') {' },
  { id: 'J18', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'apply: a Stage H transaction need not end with its marker',
    old: 'require(!applied || shaped && COMMIT_SUBTYPE.equals(lastSubtype),', neu: 'require(true || shaped && COMMIT_SUBTYPE.equals(lastSubtype),' },
  { id: 'J19', lang: 'java', file: `${J}/store/ManagedAgentStore.java`, what: 'announce: plain read of the Session status (no lock)',
    old: '+ " session_id = ? FOR UPDATE",\n                sessionMapper, tenantId, tenantId, sessionId).stream()', neu: '+ " session_id = ?",\n                sessionMapper, tenantId, tenantId, sessionId).stream()' },
  { id: 'J20', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'parse: no 64-level depth limit',
    old: '.builder().maxNestingDepth(ManagedSessionStoreModels\n                                    .MAX_JSON_DEPTH).build()).build())', neu: '.builder().maxNestingDepth(1000).build()).build())' },
  { id: 'J21', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'parse: accept non-finite numbers',
    old: 'return node != null && node.isObject() && finite(node) ? node', neu: 'return node != null && node.isObject() ? node' },
  { id: 'J22', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'apply: a Stage H transaction may hold non-event lines before its marker',
    old: 'shaped &= index >= eventCount;', neu: 'shaped &= true;' },
  { id: 'J23', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'apply: an unreadable line answers 409 instead of 400',
    old: 'throw new ApiException(HttpStatus.BAD_REQUEST,\n                        ManagedSessionStoreModels.ERROR_INVALID_REQUEST,', neu: 'throw new ApiException(HttpStatus.CONFLICT,\n                        ManagedSessionStoreModels.ERROR_INVALID_REQUEST,' },
  { id: 'T17', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'replay: a command that committed something else falls through',
    old: '    throw new ManagedSessionConflictError(\n      `command ${command.commandId} was committed without a Stage H record.`,\n    );\n  }', neu: '    return undefined;\n  }' },
  { id: 'J24', lang: 'java', file: `${J}/store/ManagedExtensionRecords.java`, what: 'rule R1-1: running/waiting on a not_started_proven execution',
    old: 'require(!"running".equals(state) && !"waiting".equals(state)\n                || !"not_started_proven".equals(execution),', neu: 'require(true || !"running".equals(state) && !"waiting".equals(state)\n                || !"not_started_proven".equals(execution),' },
  { id: 'T18', lang: 'ts', file: `${T}/managed-extension-record.ts`, what: 'rule R1-1: running/waiting on a not_started_proven execution',
    old: "(state === 'running' || state === 'waiting') &&\n    execution === 'not_started_proven'", neu: "false &&\n    execution === 'not_started_proven'" },
  { id: 'T19', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'enablement: a disabled domain commits through a generic path',
    old: "if (event.kind === 'domain.committed') {\n        assertManagedSessionDomainEnabled(", neu: "if (false) {\n        assertManagedSessionDomainEnabled(" },
  { id: 'J25', lang: 'java', file: `${J}/store/ManagedExtensionProjection.java`, what: 'W0e: ABANDONED maps to settled instead of outcome_unknown',
    old: 'case UNKNOWN, ABANDONED -> "outcome_unknown";', neu: 'case UNKNOWN -> "outcome_unknown";\n            case ABANDONED -> "settled";' },
  { id: 'J26', lang: 'java', file: `${J}/store/ManagedAgentStore.java`, what: 'announce: a DELETING Session still gets task.updated',
    old: 'if (session.isEmpty() || "DELETING".equals(session.get().status())\n', neu: 'if (session.isEmpty()\n' },
];

const env = { ...process.env, JAVA_HOME: `${process.env.HOME}/Install/jdk21`, PATH: `${process.env.HOME}/Install/jdk21/bin:${process.env.HOME}/Install/maven/bin:${process.env.PATH}` };
function runJava() {
  // The ITs expect a fresh database (fixed IDs): drop it before every run.
  execFileSync('docker', ['exec', 'pr12855-mariadb', 'mariadb', '-uroot', '-prig12855', '-e', 'DROP DATABASE IF EXISTS managed_agent_mut6']);
  const r = spawnSync('mvn', ['-o', '-B', '-s', `${SP}/m2settings.xml`, `-Dmaven.repo.local=${SP}/m2repo`, '-Pmysql-integration',
    '-Dmysql.url=jdbc:mysql://127.0.0.1:13855/managed_agent_mut6?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false',
    '-Dmysql.user=root', '-Dmysql.password=rig12855', '-Dcheckstyle.skip',
    '-Dtest=ManagedExtension*Test,ManagedAgentApiContractTest,PlannedTaskContractTest,ManagedSessionStore*Test', '-Dit.test=ManagedAgentMySqlIT',
    '-Dsurefire.failIfNoSpecifiedTests=false', 'verify'], { cwd: `${WT}/packages/sdk-java/managed-agent-server`, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout + r.stderr;
  const failed = [...out.matchAll(/\[ERROR\] (?:Tests run:.*?)?\s*([A-Za-z]+Test[A-Za-z]*|[A-Za-z]+IT)\.([A-Za-z0-9_]+)/g)].map((m) => `${m[1]}.${m[2]}`);
  const compileError = /COMPILATION ERROR/.test(out);
  const summary = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].map((m) => m[0]);
  return { status: r.status, failed: [...new Set(failed)].slice(0, 6), compileError, summary };
}
function runTs() {
  const r = spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/managed-session-authority.extension.test.ts', 'src/managed-runtime/managed-extension-projection.test.ts',
    'src/managed-runtime/managed-operation-grant-gate.test.ts', 'src/managed-runtime/http-managed-session-store.test.ts', 'src/managed-runtime/managed-session-store-contract.test.ts', 'src/managed-runtime/managed-extension-record.test.ts'], { cwd: `${WT}/packages/core`, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout + r.stderr;
  const failed = [...out.matchAll(/ (?:FAIL|×) .*?> (.*?)(?:\s+\d+ms)?$/gm)].map((m) => m[1]).slice(0, 6);
  const summary = (out.match(/Tests\s+(\d+ failed \| )?\d+ passed \(\d+\)/) ?? [''])[0];
  return { status: r.status, failed, summary };
}

const only = process.argv.slice(2);
const results = [];
if (only.includes('--baseline')) {
  console.log('baseline java', JSON.stringify(runJava()));
  console.log('baseline ts', JSON.stringify(runTs()));
  process.exit(0);
}
for (const m of MUTANTS.filter((x) => only.length === 0 || only.includes(x.id))) {
  const path = `${WT}/${m.file}`;
  const src = fs.readFileSync(path, 'utf8');
  const count = src.split(m.old).length - 1;
  if (count !== 1) {
    results.push({ id: m.id, error: `site matched ${count} times` });
    continue;
  }
  fs.writeFileSync(path, src.replace(m.old, m.neu));
  const t0 = Date.now();
  const r = m.lang === 'java' ? runJava() : runTs();
  execFileSync('git', ['checkout', '--', m.file], { cwd: WT });
  const res = { id: m.id, what: m.what, killed: r.status !== 0 && !r.compileError, compileError: r.compileError, failed: r.failed, summary: r.summary, secs: Math.round((Date.now() - t0) / 1000) };
  results.push(res);
  console.log(JSON.stringify(res));
}
fs.writeFileSync(`${SP}/rig/out/${process.env.MUT_OUT ?? 'mutants'}.json`, JSON.stringify(results, null, 1));
