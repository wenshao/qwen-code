// Mutation matrix for PR #13084 (O4-1) in ~/git/qwen-code-pr13084-mut. One mutant at a time:
// exact-once textual replacement (fail closed), CI-equivalent `-Pmysql-integration verify` (TZ=UTC, gate mysqld),
// failing test names from the reports, then `git checkout` of the file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr13084-mut`;
const MOD = `${W}/packages/sdk-java/managed-agent-server`;
const J = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent`;
const RIG = path.dirname(new URL(import.meta.url).pathname);
const OUT = `${RIG}/out/mut.jsonl`;
const st = `${J}/store`;
const M = [
  ['M01', `${st}/ToolPublicationRetentionStore.java`, `&& ((Number) head.get("writer_active")).intValue() != 0) {`, `&& false) {`, 'retire(): live-writer recheck disabled'],
  ['M02', `${st}/ManagedAgentStore.java`, `            ToolPublicationRetentionStore.retire(jdbc, tenantId, sessionId, operationId);\n`, ``, 'completeOperation(): DELETE completes without retire()'],
  ['M03', `${st}/ManagedAgentStore.java`, `            ToolPublicationRetentionStore.lockDeletion(jdbc, tenantId, sessionId);\n`, ``, 'completeOperation(): lockDeletion() removed'],
  ['M04', `${st}/ToolPublicationRetentionStore.java`, `        jdbc.update("UPDATE qwen_tool_publication SET retention_state = 'RETIRING' WHERE tenant_id = ?"\n                + " AND session_id = ? AND retention_state = 'PINNED'", tenant, session);\n`, ``, 'retire(): publications stay PINNED'],
  ['M05', `${st}/ToolPublicationRetentionStore.java`, `protectedRecovery = !"READY".equals(head.get("recovery_status"));`, `protectedRecovery = false;`, 'retire(): recovery_protected never set'],
  ['M06', `${st}/ManagedSessionStore.java`, `        ToolPublicationRetentionStore.lockTenant(jdbc, tenantId);\n        ToolPublicationRetentionStore.requireLive(jdbc, tenantId, sessionId);\n`, `        ToolPublicationRetentionStore.lockTenant(jdbc, tenantId);\n`, 'acquireWriter(): requireLive removed'],
  ['M07', `${st}/ManagedSessionStore.java`, `        ToolPublicationRetentionStore.requireLive(jdbc, head.tenantId(), head.sessionId());\n`, ``, 'requireReadGrant(): requireLive removed'],
  ['M08', `${st}/ToolPublicationStore.java`, `        ToolPublicationRetentionStore.requireLive(jdbc, row.tenant(), row.session());\n`, ``, 'publication authorize(): requireLive removed'],
  ['M09', `${st}/ToolPublicationRetentionStore.java`, `            lockSession(jdbc, tenant, session);\n            requireLive(jdbc, tenant, session);\n            String id = UUID.randomUUID().toString();\n            jdbc.update("INSERT INTO qwen_output_read_lease`, `            lockSession(jdbc, tenant, session);\n            String id = UUID.randomUUID().toString();\n            jdbc.update("INSERT INTO qwen_output_read_lease`, 'read(): lease granted on a retired Session'],
  ['M10', `${st}/ToolPublicationRetentionStore.java`, `if (closed || rows.size() != 1 || ((Number) rows.getFirst().get("expires_at")).longValue() <= ((Number) rows.getFirst().get("db_now")).longValue()`, `if (closed || rows.size() != 1`, 'ReadLease.check(): expiry ignored'],
  ['M11', `${st}/ToolPublicationRetentionStore.java`, `                    || rows.getFirst().get("generation") != null\n`, ``, 'ReadLease.check(): retirement ignored'],
  ['M12', `${st}/ToolPublicationRetentionStore.java`, `private static final long READ_BUDGET_MILLIS = 120_000;`, `private static final long READ_BUDGET_MILLIS = 3_600_000;`, 'read budget 120 s -> 1 h'],
  ['M13', `${st}/ToolPublicationRetentionStore.java`, `SET state = 'UNKNOWN' WHERE attempt_id = ?`, `SET state = 'RETURNED' WHERE attempt_id = ?`, 'put(): failed PUT recorded as RETURNED'],
  ['M14', `${st}/ToolPublicationRetentionStore.java`, `+ " AND state <> 'RETURNED'", scope, publication) != 0) {`, `+ " AND state <> 'RETURNED'", scope, publication) < 0) {`, 'candidate(): put_unresolved ignored'],
  ['M15', `${st}/ToolPublicationRetentionStore.java`, `+ " AND expires_at > ?", hash(tenant), hash(session), now(jdbc)) != 0) {`, `+ " AND expires_at > ?", hash(tenant), hash(session), now(jdbc)) < 0) {`, 'candidate(): reader_active ignored'],
  ['M16', `${st}/ToolPublicationRetentionStore.java`, `} else if (flag(roots.getFirst(), "recovery_protected")) {`, `} else if (false) {`, 'candidate(): recovery_protected ignored'],
  ['M17', `${st}/ToolPublicationRetentionStore.java`, `} else if (number(roots.getFirst(), "retired_at") > now(jdbc) - grace.toMillis()) {`, `} else if (false) {`, 'candidate(): grace ignored'],
  ['M18', `${st}/ToolPublicationRetentionStore.java`, `} else if (!flag(row, "write_evidence")) {`, `} else if (false) {`, 'candidate(): legacy evidence ignored'],
  ['M19', `${st}/ToolPublicationRetentionStore.java`, `} else if (flag(row, "quarantined")) {`, `} else if (false) {`, 'candidate(): quarantine ignored'],
  ['M20', `${st}/ToolPublicationRetentionStore.java`, `} else if (!"REFERENCED".equals(row.get("producer_phase")) || !flag(row, "accepted_complete")) {`, `} else if (!"REFERENCED".equals(row.get("producer_phase"))) {`, 'candidate(): accepted_complete ignored'],
  ['M21', `${st}/ToolPublicationAdmissionStore.java`, `"committed".equals(outcome.path("decision").asText())\n                            && "complete".equals(outcome.path("envelope").path("capture").path("captureStatus").asText()),`, `true,`, 'admission: accepted_complete always true'],
  ['M22', `${st}/ManagedToolResultStore.java`, `            if (!retired.isEmpty()) {`, `            if (false) {`, 'projection complete(): retired Session not suppressed'],
  ['M23', `${J}/service/ManagedArtifactService.java`, `                    if ("tool_output_session_retired".equals(api.getCode())\n                            || "tool_output_read_expired".equals(api.getCode())) {`, `                    if (false) {`, 'content(): retired/expired not mapped to 404/503'],
  ['M24', `${J}/config/ToolPublicationConfiguration.java`, `        client.setMaxErrorRetry(0);\n`, ``, 'OSS SDK retries re-enabled'],
  ['M25', `${st}/ToolPublicationDataStore.java`, `        if (candidate.objectKey() != null) {\n            retention.put(key, scope, publicationId, candidate.objectKey(), bytes, objects);`, `        if (candidate.objectKey() != null) {\n            objects.putIfAbsent(candidate.objectKey(), bytes);`, 'admission PUT bypasses the attempt ledger'],
  ['M26', `${st}/ToolPublicationRetentionStore.java`, `        jdbc.update("UPDATE qwen_managed_session_journal_head SET state = 'DELETED', writer_id = NULL,"`, `        if (false) jdbc.update("UPDATE qwen_managed_session_journal_head SET state = 'DELETED', writer_id = NULL,"`, 'retire(): journal head not set DELETED'],
];
const only = process.env.ONLY?.split(',');
function reports() {
  const fails = [];
  for (const d of ['surefire-reports', 'failsafe-reports']) {
    const dir = `${MOD}/target/${d}`;
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('TEST-') && x.endsWith('.xml'))) {
      const x = fs.readFileSync(`${dir}/${f}`, 'utf8');
      for (const m of x.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
        if (m[3] && /<(failure|error)/.test(m[3])) fails.push(`${m[2].split('.').at(-1)}.${m[1]}`);
      }
    }
  }
  return fails;
}
function run(label) {
  fs.rmSync(`${MOD}/target/surefire-reports`, { recursive: true, force: true });
  fs.rmSync(`${MOD}/target/failsafe-reports`, { recursive: true, force: true });
  const t0 = Date.now();
  const r = spawnSync(`${RIG}/mvn.sh`, ['-o', '-q', '-Pmysql-integration', `-Dmysql.url=jdbc:mysql://127.0.0.1:23184/mut_${label.toLowerCase()}_${Date.now()}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false`, '-Dmysql.user=root', '-Dmysql.password=gate13084', '-Dcheckstyle.skip=true', 'verify'], { cwd: MOD, env: { ...process.env, TZ: 'UTC', M2: process.env.M2 }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const compileError = /COMPILATION ERROR/.test(r.stdout);
  return { exit: r.status, ms: Date.now() - t0, compileError, fails: reports() };
}
const ctl = only ? null : run('CTL');
if (ctl) { fs.appendFileSync(OUT, JSON.stringify({ id: 'CTL', ...ctl }) + '\n'); console.log('CTL', ctl.exit, ctl.fails.length, ctl.ms); if (ctl.exit !== 0) process.exit(1); }
for (const [id, file, find, replace, desc] of M) {
  if (only && !only.includes(id)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) { fs.appendFileSync(OUT, JSON.stringify({ id, desc, error: `anchor found ${n} times` }) + '\n'); console.log(id, 'ANCHOR', n); continue; }
  fs.writeFileSync(file, src.replace(find, replace));
  const r = run(id);
  execFileSync('git', ['checkout', '--', file], { cwd: W });
  const verdict = r.compileError ? 'COMPILE-ERROR' : r.fails.length ? 'KILLED' : r.exit === 0 ? 'SURVIVED' : 'BUILD-FAILED';
  fs.appendFileSync(OUT, JSON.stringify({ id, desc, verdict, ...r }) + '\n');
  console.log(id, verdict, r.fails.slice(0, 4).join(' | '), `${Math.round(r.ms / 1000)}s`);
}
console.log('MUT-DONE', execFileSync('git', ['status', '--short'], { cwd: W, encoding: 'utf8' }).trim() || 'clean');
