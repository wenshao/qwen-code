// VERIFICATION RIG ONLY (PR #13163, round 4): Harness passive-load mutants at 30f092d0; runs
// src/serve/hosted-harness-session.test.ts (and hosted-runtime-recovery.test.ts for the recovery-file mutant).
// usage: TS_TREE=<worktree> node tsmut9.mjs [ids...]   (id C0 = unmutated control run)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.TS_TREE; if (!T) { console.error('TS_TREE required'); process.exit(2); }
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const RC = 'packages/cli/src/serve/hosted-runtime-recovery.ts';
const MUT = [
  ['T1', S, 'passive load of a resident Session answers 409 again', `      (resident && (create || (!passiveRecovery && !driveRecovery)))`, `      (resident && (create || !driveRecovery || passiveRecovery))`],
  ['T2', S, 'resident passive load skips the tenant / Workspace / store URL check', `        key.tenantId !== store.tenantId ||
        key.workspaceId !== store.workspaceId ||
        resident.storeBaseUrl !== store.baseUrl`, `        false`],
  ['T3', S, 'resident passive load skips the tool profile / MCP / hook conflict check', `      const definition = resident.definition;
      if (
        definition?.['toolProfile'] !== toolProfile ||`, `      const definition = resident.definition;
      if (
        false && definition?.['toolProfile'] !== toolProfile ||`],
  ['T4', S, 'R4-1: resident passive recovery no longer records the adopted lease (callback dropped)', `            passive: true,
            onPassiveRuntimeAcquired: (runtimeSessionId) => {
              resident.runtimeLeaseHeld = runtimeSessionId;
            },`, `            passive: true,`],
  ['T5', S, 'triage F2: parked ignores an active Turn (!resident.active operand dropped)', `        const parked = !resident.active && unsettledPromptId(resident);`, `        const parked = unsettledPromptId(resident);`],
  ['T6', S, 'triage F3: post-await identity re-check dropped', `        if (sessions.get(sessionId) !== resident) {
          error(res, 404, 'hosted_session_not_found');
          return;
        }
        if (resident.mcpClosing) {
          error(res, 409, 'hosted_session_closing');
          return;
        }
        refusedAdoptions.delete(sessionId);`, `        if (resident.mcpClosing) {
          error(res, 409, 'hosted_session_closing');
          return;
        }
        refusedAdoptions.delete(sessionId);`],
  ['T7', S, 'R4-1: cold-load passive recovery no longer records the adopted lease (callback dropped)', `            onPassiveRuntimeAcquired: (runtimeSessionId) => {
              session.runtimeLeaseHeld = runtimeSessionId;
            },`, ``],
  ['T8', RC, 'R4-1: recoverHostedRuntimeTurn stops reporting the acquire before its fallible reads', `    input.onPassiveRuntimeAcquired?.(broker.runtimeSessionId);`, ``],
  ['T9', S, 'resident catch stops noting the owed adoption', `      } catch {
        noteOwedAdoption(resident, sessionId);
        error(res, 409, 'hosted_turn_recovery_required');`, `      } catch {
        error(res, 409, 'hosted_turn_recovery_required');`],
];
const run = (files) => {
  const r = spawnSync('npx', ['vitest', 'run', ...files], { cwd: `${T}/packages/cli`, encoding: 'utf8', env: { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}` }, maxBuffer: 1 << 28 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return { tests: out.match(/Tests\s+(\d+ failed \| )?\d+ passed \(\d+\)/)?.[0] ?? 'no-summary', failed: [...new Set([...out.matchAll(/FAIL .*> ([^>\n]+)$/gm)].map((m) => m[1].trim()))] };
};
const FILES = ['src/serve/hosted-harness-session.test.ts', 'src/serve/hosted-runtime-recovery.test.ts'];
const ids = process.argv.slice(2);
if (!ids.length || ids.includes('C0')) { const res = run(FILES); console.log(`C0 ${res.tests} ${JSON.stringify(res.failed)} :: unmutated control`); }
for (const [id, file, label, find, repl] of MUT.filter((m) => !ids.length || ids.includes(m[0]))) {
  const F = `${T}/${file}`;
  const orig = fs.readFileSync(F, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) { console.log(`${id} ANCHOR=${n} SKIPPED :: ${label}`); continue; }
  fs.writeFileSync(F, orig.replace(find, repl));
  try { const res = run(FILES); console.log(`${id} ${res.tests} ${JSON.stringify(res.failed)} :: ${label}`); } finally { fs.writeFileSync(F, orig); }
}
