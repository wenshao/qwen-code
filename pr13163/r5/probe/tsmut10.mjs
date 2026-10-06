// VERIFICATION RIG ONLY (PR #13163, round 5): Harness mutants at eb3b9336; runs src/serve/hosted-harness-session.test.ts
// and src/serve/hosted-runtime-recovery.test.ts. usage: TS_TREE=<worktree> node tsmut10.mjs [ids...]   (C0 = control)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.TS_TREE; if (!T) { console.error('TS_TREE required'); process.exit(2); }
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const RC = 'packages/cli/src/serve/hosted-runtime-recovery.ts';
const MUT = [
  ['T1', S, 'passive load of a resident Session answers 409 again', `      (resident && (create || (!passiveRecovery && !driveRecovery)))`, `      (resident && (create || !driveRecovery || passiveRecovery))`],
  ['T2', S, 'b8f92ced: hoisted fence skips the tenant / Workspace check', `        key.tenantId !== store.tenantId ||
        key.workspaceId !== store.workspaceId
      ) {`, `        false
      ) {`],
  ['T3', S, 'resident passive load skips the tool profile / MCP / hook conflict check', `      const definition = resident.definition;
      if (
        definition?.['toolProfile'] !== toolProfile ||`, `      const definition = resident.definition;
      if (
        false && definition?.['toolProfile'] !== toolProfile ||`],
  ['T4', S, 'R4-1: resident passive recovery no longer records the adopted lease', `            onPassiveRuntimeAcquired: (runtimeSessionId) => {
              resident.runtimeLeaseHeld = runtimeSessionId;
            },
          }).finally(`, `          }).finally(`],
  ['T5', S, 'triage F2: parked ignores an active Turn', `        const parked = !resident.active && unsettledPromptId(resident);`, `        const parked = unsettledPromptId(resident);`],
  ['T8', RC, 'R4-1: recoverHostedRuntimeTurn stops reporting the acquire', `    input.onPassiveRuntimeAcquired?.(broker.runtimeSessionId);`, ``],
  ['T10', S, 'b8f92ced: a drifted store answers 404 again (terminal for the caller)', `        error(res, 409, 'hosted_session_store_mismatch');`, `        error(res, 404, 'hosted_session_not_found');`],
  ['T11', S, 'b8f92ced: the store-address check is dropped', `      if (resident.storeBaseUrl !== store.baseUrl) {`, `      if (false) {`],
  ['T12', S, 'b8f92ced: the hoisted fence no longer covers the drive redrive', `    if (resident !== undefined && !create) {
      const key = resident.managed.authority.sessionHeader.sessionKey;`, `    if (resident !== undefined && !create && !driveRecovery) {
      const key = resident.managed.authority.sessionHeader.sessionKey;`],
  ['T13', S, 'b6eff8f4: the parked passive recovery no longer holds the teardown fence', `          resident.mcpRecovering = true;
          const recovered = await recoverHostedRuntimeTurn({`, `          const recovered = await recoverHostedRuntimeTurn({`],
  ['T14', S, 'b6eff8f4: the fence is never lifted', `          }).finally(() => {
            resident.mcpRecovering = false;
          });`, `          });`],
  ['T15', S, 'b8f92ced: the drive redrive drops its post-await identity re-check', `      // A teardown admitted during the await above released nothing (the
      // lease was not recorded yet) and left no route to hand it back.
      if (sessions.get(sessionId) !== resident) {
        noteOwedAdoption(resident, sessionId);
        error(res, 404, 'hosted_session_not_found');
        return;
      }`, ``],
  ['T16', S, 'b683a3d6: resident passive post-await 404 stops noting the owed adoption', `        if (sessions.get(sessionId) !== resident) {
          noteOwedAdoption(resident, sessionId);
          error(res, 404, 'hosted_session_not_found');
          return;
        }
        if (resident.mcpClosing) {
          noteOwedAdoption(resident, sessionId);
          error(res, 409, 'hosted_session_closing');
          return;
        }
        refusedAdoptions.delete(sessionId);
        sendAttachment(
          res,
          sessionId,
          resident,`, `        if (sessions.get(sessionId) !== resident) {
          error(res, 404, 'hosted_session_not_found');
          return;
        }
        if (resident.mcpClosing) {
          noteOwedAdoption(resident, sessionId);
          error(res, 409, 'hosted_session_closing');
          return;
        }
        refusedAdoptions.delete(sessionId);
        sendAttachment(
          res,
          sessionId,
          resident,`],
  ['T6', S, 'triage F3: resident passive post-await identity re-check dropped', `        if (sessions.get(sessionId) !== resident) {
          noteOwedAdoption(resident, sessionId);
          error(res, 404, 'hosted_session_not_found');
          return;
        }
        if (resident.mcpClosing) {
          noteOwedAdoption(resident, sessionId);
          error(res, 409, 'hosted_session_closing');
          return;
        }
        refusedAdoptions.delete(sessionId);
        sendAttachment(
          res,
          sessionId,
          resident,`, `        if (resident.mcpClosing) {
          noteOwedAdoption(resident, sessionId);
          error(res, 409, 'hosted_session_closing');
          return;
        }
        refusedAdoptions.delete(sessionId);
        sendAttachment(
          res,
          sessionId,
          resident,`],
  ['T7', S, 'R4-1: cold-load passive recovery no longer records the adopted lease', `            onPassiveRuntimeAcquired: (runtimeSessionId) => {
              session.runtimeLeaseHeld = runtimeSessionId;
            },`, ``],
  ['T9', S, 'resident catch stops noting the owed adoption', `      } catch {
        noteOwedAdoption(resident, sessionId);
        error(res, 409, 'hosted_turn_recovery_required');`, `      } catch {
        error(res, 409, 'hosted_turn_recovery_required');`],
];
const run = (files) => {
  const r = spawnSync('npx', ['vitest', 'run', '--coverage.enabled=false', ...files], { cwd: `${T}/packages/cli`, encoding: 'utf8', env: { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}` }, maxBuffer: 1 << 28 });
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
