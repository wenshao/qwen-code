// VERIFICATION RIG ONLY: single-edit mutants of the PR's Java code, each run against the whole managed-agent-server unit suite.
// usage: node mutate.mjs <tree> [id-filter-regex]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const RIG = '/rig';
const TREE = `${RIG}/${process.argv[2] ?? 'src-mut'}`;
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const SRV = `${TREE}/packages/sdk-java/managed-agent-server`;
const J = `${SRV}/src/main/java/com/alibaba/qwen/code/managedagent`;
const STORE = `${J}/store/ManagedActionStore.java`;
const COORD = `${J}/service/ActionResponseCoordinator.java`;
const SVC = `${J}/service/ManagedActionService.java`;
const AGENT = `${J}/service/ManagedAgentService.java`;
const ASTORE = `${J}/store/ManagedAgentStore.java`;
const CONN = `${J}/harness/QwenHostedHarnessConnector.java`;
const PROPS = `${J}/config/ManagedAgentProperties.java`;

const M = [
  ['M01', STORE, '                        != 1) {\n            throw new ApiException(\n                    HttpStatus.FORBIDDEN,', '                        < 0) {\n            throw new ApiException(\n                    HttpStatus.FORBIDDEN,', 'owner check never refuses'],
  ['M02', STORE, 'if (!existing.requestDigest().equals(requestDigest)) {', 'if (false) {', 'replayed key with different content is accepted'],
  ['M03', STORE, 'if (!"requested".equals(action.state())) {\n            throw new ApiException(\n                    HttpStatus.CONFLICT,\n                    endedCode', 'if (false) {\n            throw new ApiException(\n                    HttpStatus.CONFLICT,\n                    endedCode', 'admission ignores an ended Action'],
  ['M04', STORE, 'if (now >= o.path("expiresAt").asLong()) {', 'if (false) {', 'admission ignores the expiry time'],
  ['M05', STORE, '|| body.path("inputRevision").asLong() != o.path("inputRevision").asLong()', '', 'admission ignores a stale input revision'],
  ['M06', STORE, '|| !body.path("policyRevision").equals(o.path("policyRevision"))) {', ') {', 'admission ignores a different policy revision'],
  ['M07', STORE, '" state = \'requested\'"\n                        + cursor', '" state <> \'x\'"\n                        + cursor', 'list keeps ended Actions'],
  ['M08', STORE, '" ORDER BY created_at DESC, action_id DESC LIMIT ?",', '" ORDER BY created_at ASC, action_id ASC LIMIT ?",', 'list oldest first'],
  ['M09', STORE, 'cursor = " AND (created_at < ? OR created_at = ? AND action_id < ?)";', 'cursor = " AND (created_at < ? OR created_at = ? AND action_id < \'\' AND action_id < ?)";', 'cursor drops the same-millisecond tie-break'],
  ['M10', STORE, '                                    && "requested".equals(previous.state())\n', '', 'projection lets an ended Action change again'],
  ['M11', STORE, ': previous.options().equals(options)\n', ': true\n', 'projection accepts changed options for a known Action'],
  ['M12', STORE, '&& decided.digest().equals(decisionDigest(body)));', ');', 'projection skips the decision digest check'],
  ['M13', STORE, '"decision_"\n                                + ManagedExtensionProjection.recordKey(\n                                        sessionId, "action_decision", id + ":" + decided.digest());', 'decision.path("resourceId").asText();', 'decision receipt is the raw resource id'],
  ['M14', STORE, '                    == 1) {\n                sessions.appendPublicEventIfAbsent(', '                    == 2) {\n                sessions.appendPublicEventIfAbsent(', 'no action.updated event'],
  ['M15', STORE, 'decision.put("inputRevision", response.path("inputRevision").asLong());\n        decision.put("policyRevision", response.path("policyRevision").asText());', 'decision.put("policyRevision", response.path("policyRevision").asText());\n        decision.put("inputRevision", response.path("inputRevision").asLong());', 'decision bytes use another key order'],
  ['M16', STORE, 'case "expired" -> "action_expired";', 'case "expired" -> "action_already_resolved";', 'expired reported as already resolved'],
  ['M17', STORE, 'errorCode == null ? "COMPLETED" : "FAILED",', '"COMPLETED",', 'operation completes even with an error'],
  ['M18', STORE, '" available_at <= ?) OR (delivery_state = \'LEASED\' AND lease_until < ?))"', '" available_at <= ?) OR (delivery_state = \'NEVER\' AND lease_until < ?))"', 'a crashed worker\'s lease is never reclaimed'],
  ['M19', STORE, '&& List.of("allow", "deny").contains(body.path("optionId").asText())\n                                && body.path("inputRevision").equals(options.path("inputRevision"))', '&& body.path("inputRevision").equals(options.path("inputRevision"))', 'projection accepts any decided option'],
  ['M20', STORE, '&& options.path("expiresAt").asLong()\n                                    > options.path("createdAt").asLong()\n', '', 'projection accepts expiry before creation'],
  ['M21', COORD, '                        && ManagedActionStore.decisionDigest(response.body())\n                                .equals(action.decisionDigest());', ';', 'any decided Action counts as this response\'s decision'],
  ['M22', COORD, 'if (error.getStatusCode() == 400) {', 'if (error.getStatusCode() == 499) {', 'a Harness 400 is retried forever'],
  ['M23', COORD, '            if (settled(op, actions.response(tenant, session, operation))) {\n                return;\n            }\n            long delay =', '            long delay =', 'no projection re-check after a failed call'],
  ['M24', COORD, 'if (!active.add(operation)) {\n            return;\n        }', 'active.add(operation);', 'same operation dispatched twice in one server'],
  ['M25', SVC, 'if (!"permission".equals(kind)\n                || revision == null', 'if (revision == null', 'any response kind is accepted'],
  ['M26', SVC, '"FAILED".equals(op.state()) ? response.errorCode() : null);\n    }\n\n    public WebShellCommandOperation', 'null);\n    }\n\n    public WebShellCommandOperation', 'public operation never shows failure_code'],
  ['M27', SVC, 'if (limit < 1 || limit > 100) {', 'if (limit < 1 || limit > 1000) {', 'limit accepts up to 1000'],
  ['M28', SVC, '    public JsonNode get(String tenant, String actor, String session, String id, boolean web) {\n        sessions.requireReadableSession(tenant, actor, session);', '    public JsonNode get(String tenant, String actor, String session, String id, boolean web) {', 'Action detail skips the Session read check'],
  ['M29', SVC, '        List<Action> rows = page(tenant, actor, session, cursor, limit);\n        boolean more = rows.size() > limit;\n        List<Action> page = rows.subList(0, Math.min(limit, rows.size()));\n        return new PublicActionList(', '        List<Action> rows = page(tenant, actor, session, cursor, limit);\n        boolean more = rows.size() >= limit;\n        List<Action> page = rows.subList(0, Math.min(limit, rows.size()));\n        return new PublicActionList(', 'has_more true on an exactly full last page'],
  ['M30', SVC, '.put(web ? "sessionId" : "session_id", session)\n                        .put("kind", "permission")\n                        .put("state", action.state());', '.put(web ? "sessionId" : "session_id", session)\n                        .put("kind", "permission")\n                        .put("state", "requested");', 'detail always reads requested'],
  ['M31', AGENT, '&& !"yolo".equals(actions.approvalMode(session.tenantId(), session.sessionId()));', '&& "yolo".equals(actions.approvalMode(session.tenantId(), session.sessionId()));', 'actions capability inverted'],
  ['M32', ASTORE, '        if (workspace != null) {\n            jdbc.update(\n                    "UPDATE managed_agent_session SET approval_mode = ?', '        if (workspace == null) {\n            jdbc.update(\n                    "UPDATE managed_agent_session SET approval_mode = ?', 'approval mode not pinned for Workspace Sessions'],
  ['M33', ASTORE, '" managed_agent_operation WHERE operation_kind <>"\n                                        + " \'ACTION_RESPONSE\' AND delivery_state = \'PENDING\' AND"', '" managed_agent_operation WHERE operation_kind <>"\n                                        + " \'NONE\' AND delivery_state = \'PENDING\' AND"', 'lifecycle worker also claims Action responses'],
  ['M39', ASTORE, '" managed_agent_operation WHERE operation_kind <>"\n                                + " \'ACTION_RESPONSE\' AND delivery_state = \'LEASED\' AND lease_until"', '" managed_agent_operation WHERE operation_kind <>"\n                                + " \'NONE\' AND delivery_state = \'LEASED\' AND lease_until"', 'lifecycle worker reclaims expired Action response leases'],
  ['M34', CONN, '                && !actions.approvalMode(tenantId, sessionId).equals(attached.getApprovalMode())) {', '                && false) {', 'Harness approval mode is not confirmed'],
  ['M35', CONN, '                                    session.workspace() == null || actions == null\n                                            ? approvalMode', '                                    true\n                                            ? approvalMode', 'create sends the deployment mode, not the pinned one'],
  ['M36', CONN, '                            .approvalTimeoutMs(properties.getApprovalTimeout().toMillis())\n', '', 'approval timeout is not sent'],
  ['M37', PROPS, 'if (timeout < 1000 || timeout > 86400000) {', 'if (timeout > 86400000) {', 'timeout lower bound removed'],
  ['M38', PROPS, '                        || !Set.of("yolo", "default", "auto-edit")\n                                .contains(\n                                        harness.getApprovalMode()\n                                                .toLowerCase(Locale.ROOT)))) {', ')) {', 'Workspace files start with any approval mode'],
];

const FLAKY = ['ToolPublicationStoreTest'];
const env = { ...process.env, JAVA_HOME: '/opt/jdk21', PATH: `/opt/jdk21/bin:${process.env.PATH}`, TZ: 'UTC' };
const NODE = fs.readFileSync(`${RIG}/rig.env`, 'utf8').match(/^NODE=(.*)$/m)[1];
const IT = process.env.MODE === 'it';
function run(label) {
  const log = `${RIG}/out/mut/${IT ? 'it-' : ''}${label}.log`;
  const itArgs = ['-o', '-B', '-ntp', `-Dmaven.repo.local=${RIG}/m2-test`, '-Phosted-harness-mysql', '-Dit.test=HostedPublicWorkspaceIT', '-Dfailsafe.failIfNoSpecifiedTests=false', '-Dtest=NoSuchUnit', '-Dsurefire.failIfNoSpecifiedTests=false', `-Dnode.executable=${NODE}`, `-Dqwen.cli.entry=${RIG}/dist/head/cli.js`, `-Dmysql.url=jdbc:mysql://127.0.0.1:33131/mut_${label.replace(/\W/g, '_')}_${Date.now()}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false`, '-Dmysql.user=root', '-Dmysql.password=<rig-db-password>', '-Dcheckstyle.skip=true', 'verify'];
  const r = spawnSync('mvn', IT ? itArgs : ['-o', '-B', '-ntp', `-Dmaven.repo.local=${RIG}/m2-test`, '-Dcheckstyle.skip=true', ...(process.env.EXCLUDE ? [`-Dtest=${process.env.EXCLUDE}`, '-Dsurefire.failIfNoSpecifiedTests=false'] : []), 'test'], { cwd: SRV, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  fs.writeFileSync(log, r.stdout + r.stderr);
  const out = r.stdout;
  const total = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].at(-1);
  const classes = [...new Set([...out.matchAll(/^\[ERROR\] Tests run:.*<<< (?:FAILURE|ERROR)! -- in ([\w.]+)$/gm)].map((m) => m[1].split('.').pop()))];
  const failed = [...new Set([...out.matchAll(/^\[ERROR\]\s+(?:[\w.]+\.)?([A-Z]\w+(?:Test|IT))\.(\w+)/gm)].map((m) => `${m[1]}.${m[2]}`))].filter((t) => classes.includes(t.split('.')[0]));
  const compile = /COMPILATION ERROR/.test(out);
  return { exit: r.status, total: total ? { run: +total[1], fail: +total[2], err: +total[3] } : null, failed, classes, compile };
}

fs.mkdirSync(`${RIG}/out/mut`, { recursive: true });
const results = [];
const say = (l) => { console.log(l); fs.appendFileSync(`${RIG}/out/mut/summary${IT ? '-it' : ''}.txt`, l + '\n'); };
if (!only) {
  const base = run('BASELINE');
  say(`BASELINE exit=${base.exit} ${JSON.stringify(base.total)}`);
  if (base.exit !== 0) process.exit(1);
}
for (const [id, file, find, replace, desc] of M) {
  if (only && !only.test(id)) continue;
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(find).length - 1;
  if (count !== 1) { say(`${id} INVALID anchor matched ${count} times  (${desc})`); results.push({ id, desc, verdict: 'invalid-anchor' }); continue; }
  fs.writeFileSync(file, original.replace(find, replace));
  let r;
  let reruns = 0;
  try {
    r = run(id);
    // A load-sensitive test of another feature must not count as a kill: run again when it is the only failing class.
    while (r.exit !== 0 && !r.compile && r.classes.length && r.classes.every((c) => FLAKY.includes(c)) && reruns < 3) { reruns++; r = run(`${id}-rerun${reruns}`); }
  } finally { fs.writeFileSync(file, original); }
  const verdict = r.compile ? 'COMPILE-ERROR' : r.exit === 0 ? 'SURVIVED' : r.classes.every((c) => FLAKY.includes(c)) ? 'FLAKY-ONLY' : 'KILLED';
  say(`${id} ${verdict.padEnd(9)} ${desc}  ${r.total ? `run=${r.total.run} fail=${r.total.fail} err=${r.total.err}` : ''}  ${r.failed.slice(0, 4).join(', ')}${reruns ? `  (reruns=${reruns})` : ''}`);
  results.push({ id, desc, file: file.split('/').pop(), verdict, total: r.total, failed: r.failed });
  fs.writeFileSync(`${RIG}/out/mut/results${IT ? '-it' : ''}${only ? '-' + process.argv[3].replace(/\W/g, '_').slice(0, 40) : ''}.json`, JSON.stringify(results, null, 2));
}
say(`== ${results.filter((r) => r.verdict === 'KILLED').length} killed, ${results.filter((r) => r.verdict === 'SURVIVED').length} survived, ${results.filter((r) => !['KILLED', 'SURVIVED'].includes(r.verdict)).length} invalid`);
