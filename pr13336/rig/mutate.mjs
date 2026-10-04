// Mutation witnesses for PR 13336, run in the pr13336-mutx worktree.
// Each mutant disables one rule with an anchored edit (exactly one match),
// runs the PR's Java suites, records tests/failures and which tests failed,
// and restores the file (checked byte-identical with git diff).
//
// usage: node mutate.mjs [mutantId,...]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

const WT = '/Users/wenshao/git/pr13336-mutx';
const SERVER = `${WT}/packages/sdk-java/managed-agent-server`;
const MAIN = `${SERVER}/src/main/java/com/alibaba/qwen/code/managedagent/store`;
const OUT = '/Users/wenshao/git/pr13336-rig/results/mutants.tsv';
const TESTS = [
  'ManagedExtensionRecordStoreTest',
  'ManagedExtensionProjectionContractTest',
  'ManagedSessionStoreContractFixtureTest',
  'ManagedSessionStoreIntegrationTest',
  'ToolPublicationStoreTest',
  'ManagedActionsTest',
].join(',');

const STORE = `${MAIN}/ManagedExtensionRecordStore.java`;
const MUTANTS = [
  { id: 'M0-baseline', file: STORE,
    from: 'private static final String HEADER_SUBTYPE',
    to: 'private static final String HEADER_SUBTYPE' },
  { id: 'M1-generation-ignored', file: `${MAIN}/ManagedExtensionProjection.java`,
    from: '|| ("cancelled".equals(executionStatus)\n                            && dispatchGeneration == 0)',
    to: '|| ("cancelled".equals(executionStatus)\n                            && false)' },
  { id: 'M2-event-kind-vocabulary', file: STORE,
    from: 'ManagedExtensionRecords.oneOf(event.get("kind"),\n                    ManagedExtensionRecords.EVENT_KINDS, "event.kind");',
    to: '/* kind vocabulary disabled */' },
  { id: 'M3-reserved-event-ids', file: STORE,
    from: 'require(!RESERVED_EVENT_ID.matcher(eventId).matches()',
    to: 'require(true || !RESERVED_EVENT_ID.matcher(eventId).matches()' },
  { id: 'M4-domain-membership', file: STORE,
    from: 'require(domain != null && ManagedExtensionRecords.DOMAINS\n                        .contains(domain),',
    to: 'require(domain != null,' },
  { id: 'M5-outbox-write', file: STORE,
    from: '        jdbc.update("INSERT INTO qwen_managed_session_task_event"',
    to: '        if (false) jdbc.update("INSERT INTO qwen_managed_session_task_event"' },
  // R3-3 witness: put the announcement back onto the Session event stream.
  { id: 'M6-announce-on-event-stream', file: STORE,
    from: '        jdbc.update("INSERT INTO qwen_managed_session_task_event"',
    to: '        sessions.appendPublicEventIfAbsent(tenantId, sessionId, null, "task.updated", java.util.Map.of("taskId", taskId, "state", state), false, "task:" + taskId + ":" + revision);\n        jdbc.update("INSERT INTO qwen_managed_session_task_event"' },
  { id: 'M7-unknown-subtype-anywhere', file: STORE,
    from: 'require(header >= 0 && index < header,',
    to: 'require(true,' },
  { id: 'M8-commit-marker-cap', file: STORE,
    from: 'requireLineBytes(lines[index], index,\n                            ManagedSessionStoreModels.MAX_COMMIT_MARKER_BYTES);',
    to: '/* marker cap disabled */' },
  { id: 'M9-one-stage-h-per-tx', file: STORE,
    from: 'require(stageH == 0, "Record line "',
    to: 'require(true, "Record line "' },
  { id: 'M10-sequence-place', file: STORE,
    from: 'ManagedExtensionRecords.count(event.get("sequence"), sequence,\n                    sequence, "event.sequence");',
    to: 'ManagedExtensionRecords.count(event.get("sequence"), 0,\n                    Long.MAX_VALUE, "event.sequence");' },
  { id: 'M11-deleting-session-announces', file: `${MAIN}/ManagedAgentStore.java`,
    from: '.map(status -> !"DELETING".equals(status)\n                        && !"DELETED".equals(status))',
    to: '.map(status -> true)' },
  { id: 'M12-header-cap', file: STORE,
    from: 'requireLineBytes(lines[index], index,\n                        ManagedSessionStoreModels.MAX_HEADER_BYTES);',
    to: '/* header cap disabled */' },
  { id: 'M13-envelope-closedness', file: `${MAIN}/ManagedExtensionRecords.java`,
    from: 'label + " must be an object with exactly " + keys);\n        node.fieldNames().forEachRemaining(name -> require(keys.contains(name),\n                label + " must be an object with exactly " + keys));\n    }\n\n    static String id(',
    to: 'label + " must be an object with exactly " + keys);\n        node.fieldNames().forEachRemaining(name -> require(true || keys.contains(name),\n                label + " must be an object with exactly " + keys));\n    }\n\n    static String id(' },
  { id: 'M14-body-less-payload-closed', file: STORE,
    from: 'requireDomainPayload(event.get("payload"), domain,\n                        ManagedExtensionProjection.RECORD_BODIES\n                                .containsKey(domain));',
    to: '/* body-less payload check disabled */' },
  { id: 'M15-own-session-every-event', file: STORE,
    from: 'requireOwnSession(event, tenantId, workspaceId, sessionId,\n                    "The event names another Session.");',
    to: '/* own-session check on ordinary events disabled */' },
];

function git(...args) {
  return execFileSync('git', ['-C', WT, ...args], { encoding: 'utf8' });
}
function reports() {
  const dir = `${SERVER}/target/surefire-reports`;
  let tests = 0, failures = 0, errors = 0;
  const failed = [];
  for (const f of readdirSync(dir).filter((n) => n.startsWith('TEST-') && n.endsWith('.xml'))) {
    const xml = readFileSync(`${dir}/${f}`, 'utf8');
    const head = xml.match(/<testsuite[^>]*>/)[0];
    tests += Number(head.match(/tests="(\d+)"/)[1]);
    failures += Number(head.match(/failures="(\d+)"/)[1]);
    errors += Number(head.match(/errors="(\d+)"/)[1]);
    for (const m of xml.matchAll(/<testcase name="([^"]+)" classname="[^"]*\.([A-Za-z]+)"[^>]*>\s*<(failure|error)/g)) failed.push(`${m[2]}.${m[1]}`);
  }
  return { tests, failures, errors, failed };
}

const wanted = process.argv[2] ? process.argv[2].split(',') : null;
if (git('status', '--porcelain').trim() !== '') throw new Error('mutant worktree is not clean');
for (const mutant of MUTANTS.filter((m) => !wanted || wanted.includes(m.id))) {
  const original = readFileSync(mutant.file, 'utf8');
  const count = original.split(mutant.from).length - 1;
  if (count !== 1) {
    appendFileSync(OUT, `${mutant.id}\tANCHOR_MISMATCH(${count})\n`);
    console.log(`${mutant.id} ANCHOR_MISMATCH ${count}`);
    continue;
  }
  writeFileSync(mutant.file, original.replace(mutant.from, mutant.to));
  const started = Date.now();
  const run = spawnSync('/Users/wenshao/git/pr13336-rig/mvn.sh', ['-o', '-q', '--batch-mode', 'clean', 'test',
    `-Dtest=${TESTS}`, '-Dsurefire.failIfNoSpecifiedTests=false', '-Dcheckstyle.skip', '-Dspotbugs.skip'],
    { cwd: SERVER, encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(`/Users/wenshao/git/pr13336-rig/logs/mutant-${mutant.id}.log`, run.stdout + run.stderr);
  writeFileSync(mutant.file, original);
  if (git('status', '--porcelain').trim() !== '') throw new Error(`${mutant.id}: restore left a diff`);
  let r;
  try { r = reports(); } catch (e) { r = { tests: 0, failures: 0, errors: 0, failed: [String(e)] }; }
  const compileError = /COMPILATION ERROR/.test(run.stdout + run.stderr);
  const verdict = r.tests === 0 ? (compileError ? 'COMPILE_ERROR' : 'NO_TESTS_RAN')
    : r.failures + r.errors > 0 ? 'KILLED' : 'SURVIVED';
  const line = `${mutant.id}\t${verdict}\ttests=${r.tests}\tfailures=${r.failures}\terrors=${r.errors}\t${Math.round((Date.now() - started) / 1000)}s\t${r.failed.slice(0, 8).join(',')}`;
  appendFileSync(OUT, line + '\n');
  console.log(line);
}
