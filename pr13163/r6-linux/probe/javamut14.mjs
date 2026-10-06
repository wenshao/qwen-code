// VERIFICATION RIG ONLY (PR #13163, round 6): Java mutants for d7aa13aa (V48 attempt boundary) at 13df2a65, each
// against the full managed-agent-server unit suite (mvn test) in a private copy of the module tree.
// usage: J_TREE=<copy of packages/sdk-java> M2=<repo> OUT=<dir> node javamut14.mjs [ids...]   (C0 = control)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.J_TREE;
const F = `${T}/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedAgentStore.java`;
const MUT = [
  ['J1', 'FAILED->PENDING revival no longer refreshes the attempt boundary (pre-fix revival)', `                                + " 'PENDING', mutation_attempt_sequence = ?,"
                                + " updated_at = ? WHERE tenant_id = ?"
                                + " AND operation = ? AND idempotency_key = ?",
                        session.lastSequence(), clock.millis(), tenantId,
                        operation, idempotencyKey);`, `                                + " 'PENDING',"
                                + " updated_at = ? WHERE tenant_id = ?"
                                + " AND operation = ? AND idempotency_key = ?",
                        clock.millis(), tenantId,
                        operation, idempotencyKey);`],
  ['J2', 'a new attempt no longer records its boundary (column stays NULL, legacy fallback)', `        jdbc.update("UPDATE managed_agent_command SET mutation_attempt_sequence"
                        + " = ? WHERE tenant_id = ? AND operation = ?"
                        + " AND idempotency_key = ?",
                session.lastSequence(), tenantId, operation, idempotencyKey);
`, ``],
  ['J3', 'the guard prefers the original requested event over the stored boundary (COALESCE order swapped)', `"SELECT COALESCE("
                        + " c.mutation_attempt_sequence, e.sequence_id) FROM"`, `"SELECT COALESCE("
                        + " e.sequence_id, c.mutation_attempt_sequence) FROM"`],
  ['J4', 'revival boundary off by one (lastSequence - 1)', `                        session.lastSequence(), clock.millis(), tenantId,`, `                        session.lastSequence() - 1, clock.millis(), tenantId,`],
  ['J5', 'a receipt with no boundary at all is treated as superseded', `        if (attempts.isEmpty() || attempts.getFirst() == null) {
            return false;
        }`, `        if (attempts.isEmpty() || attempts.getFirst() == null) {
            return true;
        }`],
];
const put = (f, s) => { fs.rmSync(f); fs.writeFileSync(f, s); };
const run = (tag) => {
  const log = `${process.env.OUT ?? '/tmp'}/javamut14-${tag}.log`;
  const r = spawnSync('mvn', ['-B', '-ntp', `-Dmaven.repo.local=${process.env.M2}`, '-Dmaven.repo.local.tail=/root/.m2/repository', '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', '-Djacoco.skip=true', 'test'], { cwd: `${T}/managed-agent-server`, encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, TZ: 'UTC' } });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(log, out);
  const totals = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)$/gm)].at(-1);
  const failed = [...new Set([...out.matchAll(/\[ERROR\]\s+(\S+?)(?::\d+)? (?:»|<<<|.*?<<< (?:FAILURE|ERROR))/gm)].map((m) => m[1]))].filter((s) => s.includes('.')).slice(0, 12);
  const fl = [...new Set([...out.matchAll(/^\[ERROR\] (?:Tests run:.*<<< (?:FAILURE|ERROR)!\s*)?([A-Za-z0-9_.]+Test(?:\.[A-Za-z0-9_\[\]=, ]+)?)/gm)].map((m) => m[1]))];
  return { exit: r.status, totals: totals ? totals.slice(1).join('/') : 'none', failed: fl.length ? fl : failed };
};
if (process.env.DRY) { const src = fs.readFileSync(F, 'utf8'); for (const [id, , find] of MUT) console.log(id, src.split(find).length - 1); process.exit(0); }
const ids = process.argv.slice(2);
if (!ids.length || ids.includes('C0')) { const res = run('C0'); console.log(`C0 exit=${res.exit} totals=${res.totals} failed=${JSON.stringify(res.failed)} :: control`); }
for (const [id, label, find, repl] of MUT.filter((m) => !ids.length || ids.includes(m[0]))) {
  const orig = fs.readFileSync(F, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) { console.log(`${id} ANCHOR=${n} SKIPPED :: ${label}`); continue; }
  put(F, orig.replace(find, repl));
  try { const res = run(id); console.log(`${id} exit=${res.exit} totals=${res.totals} failed=${JSON.stringify(res.failed)} :: ${label}`); } finally { put(F, orig); }
}
console.log(`JMUT-DONE ${new Date().toISOString()}`);
