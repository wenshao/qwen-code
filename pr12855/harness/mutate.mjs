// Targeted mutants against the PR's own suites, in a separate worktree.
// Each mutant is one exact replacement; the suite verdict is the exit code
// (killed = the suite fails), and the source is restored with git after each.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad';
const WT = `${SP}/wt-mut`;
const J = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const T = 'packages/core/src/managed-runtime';
const MUTANTS = [
  { id: 'J4', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'announce: drop the tenant check on the public Session',
    old: 'if (session.isEmpty() || !tenantId.equals(session.get().tenantId())) {', neu: 'if (session.isEmpty()) {' },
  { id: 'J6', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'apply: drop the recordRef byteLength match',
    old: '&& resource.byteLength() == recordRef.path("byteLength")\n                        .asLong(-1)', neu: '&& (resource.byteLength() >= 0 || recordRef.path("byteLength")\n                        .asLong(-1) == 0)' },
  { id: 'J7', lang: 'java', file: `${J}/service/ManagedTaskService.java`, what: 'list: accept limit up to 1000',
    old: 'if (limit < 1 || limit > 100) {', neu: 'if (limit < 1 || limit > 1000) {' },
  { id: 'J8', lang: 'java', file: `${J}/service/ManagedTaskService.java`, what: 'list: build next_cursor from the first row of the page',
    old: 'TaskRow last = page.tasks().get(page.tasks().size() - 1);', neu: 'TaskRow last = page.tasks().get(0);' },
  { id: 'J11', lang: 'java', file: `${J}/store/ManagedExtensionRecordStore.java`, what: 'announce: dedupe key without the revision',
    old: '"task:" + taskId + ":" + revision);', neu: '"task:" + taskId);' },
  { id: 'T1', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'taskViews: ascending task ID on a createdAt tie',
    old: ': left.taskId < right.taskId\n            ? 1\n            : -1,', neu: ': left.taskId < right.taskId\n            ? -1\n            : 1,' },
  { id: 'T4', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'rebuild: accept a revision that no longer chains',
    old: 'throw new ManagedSessionRecordError(\n          `session log is corrupt: ${message}`,\n        );', neu: 'void message;' },
  { id: 'T6', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'grant: issue for an ended record with nothing to deliver',
    old: 'TERMINAL_RUN_STATES.has(record.run.state) &&\n      !isExtensionDeliveryPending(record.run)', neu: 'false &&\n      !isExtensionDeliveryPending(record.run)' },
  { id: 'T8', lang: 'ts', file: `${T}/http-managed-session-store.ts`, what: 'HTTP store: stop sending the resources a Stage H body names',
    old: '} else if (EXTENSION_RECORD_KINDS.has(ref.kind)) {', neu: '} else if (false) {' },
  { id: 'T9', lang: 'ts', file: `${T}/managed-session-authority.ts`, what: 'replay: same command with other content replays instead of conflicting',
    old: 'if (previous.contentDigest !== command.contentDigest) {\n      throw new ManagedSessionConflictError(\n        `command ${command.commandId} was already committed with different content.`,', neu: 'if (false) {\n      throw new ManagedSessionConflictError(\n        `command ${command.commandId} was already committed with different content.`,' },
];

const env = { ...process.env, JAVA_HOME: `${process.env.HOME}/Install/jdk21`, PATH: `${process.env.HOME}/Install/jdk21/bin:${process.env.HOME}/Install/maven/bin:${process.env.PATH}` };
function runJava() {
  // The ITs expect a fresh database (fixed IDs): drop it before every run.
  execFileSync('docker', ['exec', 'pr12855-mariadb', 'mariadb', '-uroot', '-prig12855', '-e', 'DROP DATABASE IF EXISTS managed_agent_mut']);
  const r = spawnSync('mvn', ['-o', '-B', '-s', `${SP}/m2settings.xml`, `-Dmaven.repo.local=${SP}/m2repo`, '-Pmysql-integration',
    '-Dmysql.url=jdbc:mysql://127.0.0.1:13855/managed_agent_mut?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false',
    '-Dmysql.user=root', '-Dmysql.password=rig12855', '-Dcheckstyle.skip',
    '-Dtest=ManagedExtension*Test,ManagedAgentApiContractTest,PlannedTaskContractTest', '-Dit.test=ManagedAgentMySqlIT',
    '-Dsurefire.failIfNoSpecifiedTests=false', 'verify'], { cwd: `${WT}/packages/sdk-java/managed-agent-server`, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout + r.stderr;
  const failed = [...out.matchAll(/\[ERROR\] (?:Tests run:.*?)?\s*([A-Za-z]+Test[A-Za-z]*|[A-Za-z]+IT)\.([A-Za-z0-9_]+)/g)].map((m) => `${m[1]}.${m[2]}`);
  const compileError = /COMPILATION ERROR/.test(out);
  const summary = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].map((m) => m[0]);
  return { status: r.status, failed: [...new Set(failed)].slice(0, 6), compileError, summary };
}
function runTs() {
  const r = spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/managed-session-authority.extension.test.ts', 'src/managed-runtime/managed-extension-projection.test.ts',
    'src/managed-runtime/managed-operation-grant-gate.test.ts', 'src/managed-runtime/http-managed-session-store.test.ts'], { cwd: `${WT}/packages/core`, env, encoding: 'utf8', maxBuffer: 1 << 28 });
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
fs.writeFileSync(`${SP}/rig/out/mutants.json`, JSON.stringify(results, null, 1));
