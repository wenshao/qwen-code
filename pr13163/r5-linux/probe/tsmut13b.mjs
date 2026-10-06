// VERIFICATION RIG ONLY (PR #13163, round 5): Harness mutants for the three commits after round 4
// (b683a3d6, b8f92ced, b6eff8f4) and the 25eb9ae2 merge fix. Runs hosted-harness-session.test.ts (+ the issue-13328 file and
// hosted-runtime-recovery.test.ts). The mutation tree is a hardlinked copy, so every write unlinks first (new inode).
// usage: TS_TREE=<tree> node tsmut13.mjs [ids...]   (C0 = unmutated control)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.TS_TREE; if (!T) { console.error('TS_TREE required'); process.exit(2); }
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const MUT = [
  ['H1', 'b6eff8f4: parked passive recovery no longer holds close()\'s fence (mcpRecovering never set)', `          resident.mcpRecovering = true;
          const recovered = await recoverHostedRuntimeTurn({`, `          const recovered = await recoverHostedRuntimeTurn({`],
  ['H2', 'b6eff8f4 overshoot: the fence is never lifted after the recovery', `          }).finally(() => {
            resident.mcpRecovering = false;
          });`, `          });`],
  ['H3', 'b8f92ced: a drifted Session Store address answers 404 again (terminal) instead of the retryable 409', `      if (resident.storeBaseUrl !== store.baseUrl) {
        error(res, 409, 'hosted_session_store_mismatch');`, `      if (resident.storeBaseUrl !== store.baseUrl) {
        error(res, 404, 'hosted_session_not_found');`],
  ['H4', 'b8f92ced: the hoisted identity fence covers only the passive branch (drive redrive unfenced, pre-fix layout)', `    if (resident !== undefined && !create) {
      const key = resident.managed.authority.sessionHeader.sessionKey;`, `    if (resident !== undefined && !create && !(driveRecovery && !passiveRecovery)) {
      const key = resident.managed.authority.sessionHeader.sessionKey;`],
  ['H5', 'b8f92ced: drive redrive drops the post-await "Session still registered" exit', `      // A teardown admitted during the await above released nothing (the
      // lease was not recorded yet) and left no route to hand it back.
      if (sessions.get(sessionId) !== resident) {
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
      sendAttachment(res, sessionId, resident, recovery);`, `      if (resident.mcpClosing) {
        noteOwedAdoption(resident, sessionId);
        error(res, 409, 'hosted_session_closing');
        return;
      }
      refusedAdoptions.delete(sessionId);
      sendAttachment(res, sessionId, resident, recovery);`],
  ['H6', 'b8f92ced: drive redrive drops the post-await mcpClosing exit', `        error(res, 404, 'hosted_session_not_found');
        return;
      }
      if (resident.mcpClosing) {
        noteOwedAdoption(resident, sessionId);
        error(res, 409, 'hosted_session_closing');
        return;
      }
      refusedAdoptions.delete(sessionId);
      sendAttachment(res, sessionId, resident, recovery);`, `        error(res, 404, 'hosted_session_not_found');
        return;
      }
      refusedAdoptions.delete(sessionId);
      sendAttachment(res, sessionId, resident, recovery);`],
  ['H7', 'b683a3d6: passive exits stop noting the owed adoption (both post-await exits)', `        if (sessions.get(sessionId) !== resident) {
          noteOwedAdoption(resident, sessionId);
          error(res, 404, 'hosted_session_not_found');
          return;
        }
        if (resident.mcpClosing) {
          noteOwedAdoption(resident, sessionId);
          error(res, 409, 'hosted_session_closing');`, `        if (sessions.get(sessionId) !== resident) {
          error(res, 404, 'hosted_session_not_found');
          return;
        }
        if (resident.mcpClosing) {
          error(res, 409, 'hosted_session_closing');`],
  ['H8', 'b683a3d6: drive redrive with no parked Turn stops draining refusedAdoptions', `        refusedAdoptions.delete(sessionId);
        sendAttachment(res, sessionId, resident);
        return;`, `        sendAttachment(res, sessionId, resident);
        return;`],
  ['H9', 'b683a3d6: drive redrive success exit stops draining refusedAdoptions', `      refusedAdoptions.delete(sessionId);
      sendAttachment(res, sessionId, resident, recovery);
      return;
    }`, `      sendAttachment(res, sessionId, resident, recovery);
      return;
    }`],
  ['P1', '25eb9ae2: the resident reattach branch defaults the profile only for the two /1 profiles again', `        toolProfile === undefined &&
        isHostedWorkspaceProfile(resident.toolProfile)
      )`, `        toolProfile === undefined &&
        (resident.toolProfile === 'hosted-workspace-files/1' ||
          resident.toolProfile === 'hosted-workspace-shell/1')
      )`],
  ['P2', '25eb9ae2: the resident captureBytes conflict check recognises only the /1 shell profile again', `        (isHostedWorkspaceShellProfile(toolProfile) &&
          captureBytes !== undefined &&
          definition?.['captureBytes'] !== captureBytes)
      ) {
        error(res, 409, 'hosted_tool_profile_conflict');`, `        (toolProfile === 'hosted-workspace-shell/1' &&
          captureBytes !== undefined &&
          definition?.['captureBytes'] !== captureBytes)
      ) {
        error(res, 409, 'hosted_tool_profile_conflict');`],
];
if (process.env.DRY) { const src = fs.readFileSync(process.env.DRY, 'utf8'); for (const [id, , find] of MUT) console.log(id, src.split(find).length - 1); process.exit(0); }
const FILES = ['src/serve/hosted-harness-session.test.ts', 'src/serve/hosted-harness-session.issue-13328.test.ts', 'src/serve/hosted-runtime-recovery.test.ts'];
const run = () => {
  const r = spawnSync('npx', ['vitest', 'run', ...FILES], { cwd: `${T}/packages/cli`, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return { tests: out.match(/Tests\s+(\d+ failed \| )?\d+ passed( \| \d+ skipped)? \(\d+\)/)?.[0] ?? 'no-summary', failed: [...new Set([...out.matchAll(/(?:FAIL|×) .*?> ([^>\n]+?)(?: \d+ms)?$/gm)].map((m) => m[1].trim()))] };
};
const put = (f, s) => { fs.rmSync(f); fs.writeFileSync(f, s); };
const ids = process.argv.slice(2);
if (!ids.length || ids.includes('C0')) { const res = run(); console.log(`C0 ${res.tests} ${JSON.stringify(res.failed)} :: unmutated control`); }
for (const [id, label, find, repl] of MUT.filter((m) => !ids.length || ids.includes(m[0]))) {
  const F = `${T}/${S}`;
  const orig = fs.readFileSync(F, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) { console.log(`${id} ANCHOR=${n} SKIPPED :: ${label}`); continue; }
  put(F, orig.replace(find, repl));
  try { const res = run(); console.log(`${id} ${res.tests} ${JSON.stringify(res.failed)} :: ${label}`); } finally { put(F, orig); }
}
console.log(`TSMUT-DONE ${new Date().toISOString()}`);
