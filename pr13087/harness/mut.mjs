// PR #13087 mutation matrix: apply one mutant at a time to the -mut worktree, run the
// collector/retention/adapter unit tests, record which tests fail, restore the file.
// usage: node mut.mjs [mutant ids...]   (needs MUT_RUN=1 so a syntax check never runs it)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
if (process.env.MUT_RUN !== '1') { console.error('set MUT_RUN=1'); process.exit(2); }
const WT = `${process.env.HOME}/git/qwen-code-pr13087-mut`;
const MOD = `${WT}/packages/sdk-java/managed-agent-server`;
const SRC = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent/store`;
const C = `${SRC}/ToolPublicationCollector.java`;
const A = `${SRC}/AliyunToolPublicationObjectStore.java`;
const RIG = path.dirname(new URL(import.meta.url).pathname);
const OUT = `${RIG}/out/mutation.log`;
const M = [
  ['M1', C, 'eligibility recheck skipped before DELETING', 'if (observed.blocker() != null) {', 'if (false && observed.blocker() != null) {'],
  ['M2', C, 'confirm ignores the cursor fence', ' || !claim.cursor().equals(row.get("gc_cursor"))) {', ') {'],
  ['M3', C, 'confirm ignores the generation fence', '|| ToolPublicationRetentionStore.number(row, "gc_generation") != claim.generation()', ''],
  ['M4', C, 'confirm ignores the owner fence', 'if (!"DELETING".equals(row.get("retention_state")) || !owner.equals(row.get("gc_owner"))', 'if (!"DELETING".equals(row.get("retention_state"))'],
  ['M5', C, 'quota released after the first page', 'if (!remaining.isEmpty()) {', 'if (false && !remaining.isEmpty()) {'],
  ['M6', C, 'remaining probe uses >= (never completes)', 'AND publication_id = ? AND slot_key > ? LIMIT 1"', 'AND publication_id = ? AND slot_key >= ? LIMIT 1"'],
  ['M7', C, 'page ignores the cursor', 'AND slot_key > ? ORDER BY slot_key LIMIT 100"', 'AND (slot_key > ? OR 1 = 1) ORDER BY slot_key LIMIT 100"'],
  ['M8', C, 'no deferral after a failed page', 'try {\n                defer(claim);\n            } catch (RuntimeException later) {', 'try {\n            } catch (RuntimeException later) {'],
  ['M9', C, 'deferral without delay', 'ToolPublicationRetentionStore.now(jdbc) + CLAIM_MILLIS,\n                claim.scope(), claim.publication(), owner, claim.generation());', 'ToolPublicationRetentionStore.now(jdbc),\n                claim.scope(), claim.publication(), owner, claim.generation());'],
  ['M11', C, 'Session resource inline copies not cleared', 'jdbc.update("UPDATE qwen_managed_session_resource SET inline_bytes = NULL', 'if (false) jdbc.update("UPDATE qwen_managed_session_resource SET inline_bytes = NULL'],
  ['M12', C, 'Session resource cleanup not limited to the publication', ' AND session_id = ? AND resource_id IN (SELECT resource_id FROM qwen_tool_publication_object"\n                        + " WHERE scope_key = ? AND publication_id = ?)",', ' AND session_id = ? AND (1 = 1 OR resource_id IN (SELECT resource_id FROM qwen_tool_publication_object"\n                        + " WHERE scope_key = ? AND publication_id = ?))",'],
  ['M13', C, 'used bytes not zeroed', 'capture_used_bytes = 0, producer_used_bytes = 0, admission_used_bytes = 0"', 'capture_used_bytes = capture_used_bytes, producer_used_bytes = producer_used_bytes, admission_used_bytes = admission_used_bytes"'],
  ['M14', C, 'held bytes not zeroed', 'capture_held_bytes = 0, producer_held_bytes = 0, admission_held_bytes = 0,', 'capture_held_bytes = capture_held_bytes, producer_held_bytes = producer_held_bytes, admission_held_bytes = admission_held_bytes,'],
  ['M15', C, 'publication object inline copies not cleared', '"UPDATE qwen_tool_publication_object SET inline_bytes = NULL, state = \'COLLECTED\'"', '"UPDATE qwen_tool_publication_object SET state = \'COLLECTED\'"'],
  ['M16', C, 'claim steals a live claim of another worker', '|| !owner.equals(row.get("gc_owner"))\n                    && ToolPublicationRetentionStore.number(row, "gc_claim_until") > now) {', ') {'],
  ['M17', C, 'renew ignores the owner', 'AND retention_state = \'DELETING\' AND gc_owner = ?"', 'AND retention_state = \'DELETING\' AND (gc_owner = ? OR 1 = 1)"'],
  ['M18', C, 'renew ignores the generation', '+ " AND gc_generation = ? AND gc_claim_until > ?",', '+ " AND (gc_generation = ? OR 1 = 1) AND gc_claim_until > ?",'],
  ['M19', C, 'page-level versioning check removed', '            objects.requireUnversioned();\n            for (var object : page) {', '            for (var object : page) {'],
  ['M20', C, 'tick lets the exception escape', '        try {\n            runOnce();\n        } catch (RuntimeException error) {\n            LOG.warn("Tool output collection will retry owner={}", owner, error);\n        }', '        runOnce();'],
  ['M21', C, 'claim skips the in-transaction gc_next_at recheck', 'if (ToolPublicationRetentionStore.number(row, "gc_next_at") > now) {\n                    return null;\n                }', ''],
  ['M22', C, 'confirm deletes unexpired read leases', 'AND session_key = ? AND expires_at <= ?",', 'AND session_key = ? AND (expires_at <= ? OR 1 = 1)",'],
  ['M23', C, 'gc-enabled flag ignored', 'if (!properties.getToolPublication().isGcEnabled()) {', 'if (false && !properties.getToolPublication().isGcEnabled()) {'],
  ['M24', A, 'adapter delete without its own versioning check', '    public void deleteIfPresent(String key) {\n        requireUnversioned();', '    public void deleteIfPresent(String key) {'],
];
const PAIRS = [
  ['M3+M4', C, 'confirm ignores both owner and generation', [M.find((m) => m[0] === 'M3'), M.find((m) => m[0] === 'M4')]],
  ['M17+M18', C, 'renew ignores both owner and generation', [M.find((m) => m[0] === 'M17'), M.find((m) => m[0] === 'M18')]],
  ['M2+M3+M4', C, 'confirm ignores owner, generation and cursor', [M.find((m) => m[0] === 'M2'), M.find((m) => m[0] === 'M3'), M.find((m) => m[0] === 'M4')]],
];
for (const [id, file, desc, parts] of PAIRS) M.push([id, file, desc, parts.map((p) => p[3]), parts.map((p) => p[4])]);
const want = process.argv.slice(2);
const tests = 'ToolPublicationCollectorTest,ToolPublicationRetentionStoreTest,AliyunToolPublicationObjectStoreTest';
function run(label) {
  const t0 = Date.now();
  const r = spawnSync(`${RIG}/mvn.sh`, ['-o', '-q', '-f', `${MOD}/pom.xml`, 'test', `-Dtest=${tests}`, '-Dsurefire.failIfNoSpecifiedTests=false'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const reports = `${MOD}/target/surefire-reports`;
  const failed = [];
  let total = 0;
  if (fs.existsSync(reports)) for (const f of fs.readdirSync(reports).filter((x) => x.endsWith('.xml'))) {
    const xml = fs.readFileSync(`${reports}/${f}`, 'utf8');
    total += Number(xml.match(/tests="(\d+)"/)?.[1] ?? 0);
    for (const m of xml.matchAll(/<testcase name="([^"]+)" classname="([^"]+)"[^>]*>\s*<(failure|error)/g)) failed.push(`${m[2].split('.').pop()}.${m[1]}`);
  }
  const compileError = /COMPILATION ERROR|cannot find symbol/.test(r.stdout + r.stderr);
  const line = `${label} exit=${r.status} tests=${total} failed=${failed.length}${compileError ? ' COMPILE-ERROR' : ''} ${(Date.now() - t0) / 1000}s ${[...new Set(failed)].slice(0, 6).join(', ')}`;
  console.log(line); fs.appendFileSync(OUT, line + '\n');
  return { status: r.status, total, failed, compileError };
}
if (process.env.MUT_DRY !== '1') fs.appendFileSync(OUT, `## ${new Date().toISOString()} head ${execFileSync('git', ['-C', WT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()}\n`);
const clean = execFileSync('git', ['-C', WT, 'status', '--porcelain', '--', 'packages/sdk-java/managed-agent-server/src/main'], { encoding: 'utf8' });
if (clean.trim()) throw new Error('mut worktree not clean: ' + clean);
if (process.env.MUT_DRY !== '1' && (!want.length || want.includes('control'))) {
  const c = run('control (no mutation)');
  if (c.status !== 0 || c.failed.length || c.total === 0) throw new Error('control run is not green');
}
for (const [id, file, desc, from, to] of M) {
  if (want.length && !want.includes(id)) continue;
  const orig = fs.readFileSync(file, 'utf8');
  const froms = Array.isArray(from) ? from : [from], tos = Array.isArray(to) ? to : [to];
  let mutated = orig, bad = false;
  for (let i = 0; i < froms.length; i++) { const n = mutated.split(froms[i]).length - 1; if (n !== 1) { bad = true; const l = `${id} ANCHOR-COUNT=${n} (${desc}) — not run`; console.log(l); fs.appendFileSync(OUT, l + '\n'); break; } mutated = mutated.replace(froms[i], tos[i]); }
  if (bad) continue;
  if (process.env.MUT_DRY === '1') { console.log(`${id} anchor ok (${desc})`); continue; }
  fs.writeFileSync(file, mutated);
  try {
    const r = run(`${id} ${desc}:`);
    const verdict = r.compileError ? 'INVALID' : r.failed.length ? 'KILLED' : r.status === 0 ? 'SURVIVED' : 'KILLED(exit)';
    fs.appendFileSync(OUT, `   => ${id} ${verdict}\n`);
    console.log(`   => ${id} ${verdict}`);
  } finally {
    fs.writeFileSync(file, orig);
  }
}
const after = execFileSync('git', ['-C', WT, 'status', '--porcelain', '--', 'packages/sdk-java/managed-agent-server/src/main'], { encoding: 'utf8' });
if (after.trim()) throw new Error('mut worktree left dirty: ' + after);
