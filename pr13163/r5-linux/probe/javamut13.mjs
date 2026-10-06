// VERIFICATION RIG ONLY (PR #13163, round 5): Java mutants for df8bdc56 at eb3b9336, each against the full
// managed-agent-server unit suite (mvn test) in a private copy of the module tree.
// usage: J_TREE=<copy of packages/sdk-java> node javamut13.mjs [ids...]   (C0 = control)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.J_TREE;
const F = `${T}/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service/ManagedAgentService.java`;
const MUT = [
  ['J1', 'df8bdc56 reverted: requireCanceller drops the Session lifecycle term again (hand-copied workspace/files disjuncts)', `        SessionRecord session = store.requireSession(tenantId, sessionId);
        if (!maySubmitShape(session)
                || !workspaces.canRead(`, `        SessionRecord session = store.requireSession(tenantId, sessionId);
        if (session.workspace() == null
                || !harness.isWorkspaceFilesAvailable()
                || !workspaces.canRead(`],
  ['J2', 'requireCanceller drops the creator check (createdSession)', `                || !workspaces.createdSession(session.tenantId(), actorId,
                        session.sessionId())) {
            requireLegacyWorkspace(session, actorId);
        }
    }

    private boolean maySubmitWorkspaceTurn(SessionRecord session,
            String actorId) {`, `                ) {
            requireLegacyWorkspace(session, actorId);
        }
    }

    private boolean maySubmitWorkspaceTurn(SessionRecord session,
            String actorId) {`],
  ['J3', 'maySubmitShape drops the deletedAt term (affects submit, rename and cancel)', `        return "ACTIVE".equals(session.status()) && session.deletedAt() == null`, `        return "ACTIVE".equals(session.status())`],
];
const put = (f, s) => { fs.rmSync(f); fs.writeFileSync(f, s); };
const run = (tag) => {
  const log = `${process.env.OUT ?? '/tmp'}/javamut13-${tag}.log`;
  const r = spawnSync('mvn', ['-B', '-ntp', `-Dmaven.repo.local=${process.env.M2}`, '-Dmaven.repo.local.tail=/root/.m2/repository', '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', '-Djacoco.skip=true', 'test'], { cwd: `${T}/managed-agent-server`, encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, TZ: 'UTC' } });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(log, out);
  const totals = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)$/gm)].at(-1);
  const failed = [...new Set([...out.matchAll(/\[ERROR\]\s+(\S+?)(?::\d+)? (?:»|<<<|.*?<<< (?:FAILURE|ERROR))/gm)].map((m) => m[1]))].filter((s) => s.includes('.')).slice(0, 12);
  const fl = [...new Set([...out.matchAll(/^\[ERROR\] (?:Tests run:.*<<< (?:FAILURE|ERROR)!\s*)?([A-Za-z0-9_.]+Test(?:\.[A-Za-z0-9_]+)?)/gm)].map((m) => m[1]))];
  return { exit: r.status, totals: totals ? totals.slice(1).join('/') : 'none', failed: fl.length ? fl : failed };
};
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
