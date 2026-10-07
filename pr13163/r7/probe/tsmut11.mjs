// VERIFICATION RIG ONLY (PR #13163, round 7): Harness mutants at f2864f6a; runs src/serve/hosted-harness-session.test.ts
// and src/serve/hosted-runtime-recovery.test.ts. usage: TS_TREE=<worktree> node tsmut11.mjs [ids...]   (C0 = control)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.TS_TREE; if (!T) { console.error('TS_TREE required'); process.exit(2); }
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const MUT = [
  ['T17', S, 'f2864f6a: a live owner is sent to the ownerless cancellation-takeover arm again', `        !resident.hooks &&
        resident.active === undefined &&
        (passiveRecovery || driveRecovery) &&
        body?.['cancellationTakeover'] === true`, `        !resident.hooks &&
        (passiveRecovery || driveRecovery) &&
        body?.['cancellationTakeover'] === true`],
  ['T13', S, 'd7aa13aa: the parked passive recovery no longer takes the counted fence', `          resident.mcpRecovering += 1;
          const outcome = await recoverHostedRuntimeTurn({`, `          const outcome = await recoverHostedRuntimeTurn({`],
  ['T14', S, 'd7aa13aa: the counted fence is never released', `          }).finally(() => {
            resident.mcpRecovering -= 1;
          });`, `          });`],
  ['T18', S, 'd7aa13aa: the fence is a set/clear boolean again', `          resident.mcpRecovering += 1;
          const outcome = await recoverHostedRuntimeTurn({`, `          resident.mcpRecovering = 1;
          const outcome = await recoverHostedRuntimeTurn({`],
  ['T10', S, 'b8f92ced: a drifted store answers 404 again', `        error(res, 409, 'hosted_session_store_mismatch');`, `        error(res, 404, 'hosted_session_not_found');`],
  ['T11', S, 'b8f92ced: the store-address check is dropped', `      if (resident.storeBaseUrl !== store.baseUrl) {`, `      if (false) {`],
  ['T2', S, 'resident reattach skips the tenant / Workspace check', `        key.tenantId !== store.tenantId ||
        key.workspaceId !== store.workspaceId
      ) {
        error(res, 409, 'hosted_session_already_attached');`, `        false
      ) {
        error(res, 409, 'hosted_session_already_attached');`],
  ['T4', S, 'R4-1: resident passive recovery no longer records the adopted lease', `            passive: true,
            onPassiveRuntimeAcquired: (runtimeSessionId) => {
              resident.runtimeLeaseHeld = runtimeSessionId;
            },
          }).finally(() => {
            resident.mcpRecovering -= 1;`, `            passive: true,
          }).finally(() => {
            resident.mcpRecovering -= 1;`],
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
