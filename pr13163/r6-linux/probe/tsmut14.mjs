// VERIFICATION RIG ONLY (PR #13163, round 6): Harness mutants for d7aa13aa (counted recovery fence) at 13df2a65,
// plus the round-5 P1/P2 /2-profile mutants re-run. Runs hosted-harness-session.test.ts (+ the issue-13328 file and
// hosted-runtime-recovery.test.ts). The mutation tree is a hardlinked copy, so every write unlinks first (new inode).
// usage: TS_TREE=<tree> node tsmut14.mjs [ids...]   (C0 = unmutated control)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.TS_TREE; if (!T) { console.error('TS_TREE required'); process.exit(2); }
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const MUT = [
  ['N1', 'd7aa13aa reverted: the passive branch sets and clears the fence instead of counting (first finisher lifts it)', `          resident.mcpRecovering += 1;
          const recovered = await recoverHostedRuntimeTurn({`, `          resident.mcpRecovering = 1;
          const recovered = await recoverHostedRuntimeTurn({`],
  ['N2', 'd7aa13aa half-reverted: the passive branch counts up but its finally clears the fence outright', `          }).finally(() => {
            resident.mcpRecovering -= 1;
          });`, `          }).finally(() => {
            resident.mcpRecovering = 0;
          });`],
  ['N3', 'the passive branch never takes the fence (b6eff8f4 + d7aa13aa both lost)', `          resident.mcpRecovering += 1;
          const recovered = await recoverHostedRuntimeTurn({`, `          const recovered = await recoverHostedRuntimeTurn({`],
  ['N4', 'the MCP cancel route never releases the shared counter (fence stuck after one MCP cancel)', `        () => error(res, 503, 'hosted_mcp_cancel_failed'),
      )
      .finally(() => {
        session.mcpRecovering -= 1;
      });`, `        () => error(res, 503, 'hosted_mcp_cancel_failed'),
      )
      .finally(() => {});`],
  ['N5', 'monitor wake ignores a single in-flight recovery (> 0 becomes > 1)', `          session.mcpRecovering > 0 ||`, `          session.mcpRecovering > 1 ||`],
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
