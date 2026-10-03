// VERIFICATION RIG ONLY (PR #13163): Harness passive-load mutants; runs src/serve/hosted-harness-session.test.ts.
// usage: TS_TREE=<worktree> node tsmut.mjs [ids...]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.TS_TREE; if (!T) { console.error('TS_TREE required'); process.exit(2); }
const F = `${T}/packages/cli/src/serve/hosted-harness-session.ts`;
const MUT = [
  ['T1', 'passive load of a resident Session answers 409 again', `      (resident && (create || body?.['passiveManagedRuntimeRecovery'] !== true))`, `      resident`],
  ['T2', 'resident passive load skips the tenant / Workspace / store URL check', `        key.tenantId !== store.tenantId ||
        key.workspaceId !== store.workspaceId ||
        resident.storeBaseUrl !== store.baseUrl`, `        false`],
  ['T3', 'resident passive load skips the tool profile / MCP / hook conflict check', `      const definition = resident.definition;
      if (
        definition?.['toolProfile'] !== toolProfile ||`, `      const definition = resident.definition;
      if (
        false && definition?.['toolProfile'] !== toolProfile ||`],
];
const run = () => {
  const r = spawnSync('npx', ['vitest', 'run', 'src/serve/hosted-harness-session.test.ts'], { cwd: `${T}/packages/cli`, encoding: 'utf8', env: { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}` }, maxBuffer: 1 << 28 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return { tests: out.match(/Tests\s+(\d+ failed \| )?\d+ passed \(\d+\)/)?.[0] ?? 'no-summary', failed: [...new Set([...out.matchAll(/FAIL .*> ([^>\n]+)$/gm)].map((m) => m[1].trim()))] };
};
const ids = process.argv.slice(2);
for (const [id, label, find, repl] of MUT.filter((m) => !ids.length || ids.includes(m[0]))) {
  const orig = fs.readFileSync(F, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) { console.log(`${id} ANCHOR=${n} SKIPPED :: ${label}`); continue; }
  fs.writeFileSync(F, orig.replace(find, repl));
  try { const res = run(); console.log(`${id} ${res.tests} ${JSON.stringify(res.failed)} :: ${label}`); } finally { fs.writeFileSync(F, orig); }
}
