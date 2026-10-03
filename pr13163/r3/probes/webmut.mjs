// VERIFICATION RIG ONLY (PR #13163): two WebShell mutants over the Cancel decoupling; runs the managed vitest files.
// usage: WEB_TREE=<worktree> node webmut.mjs
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = process.env.WEB_TREE; if (!T) { console.error('WEB_TREE required'); process.exit(2); }
const M = `${T}/packages/web-shell/client/components/managed`;
const P = `${M}/java-managed-agent-provider.ts`, G = `${M}/ManagedSessionsPage.tsx`;
const MUT = [
  ['BASE', null, null, null],
  ['W1', P, `canCancel: sessionActive && active && turnStatus !== 'cancelling',`, `canCancel: sessionActive && active && turnStatus !== 'cancelling' && (!session.workspace || workspaceTurns),`],
  ['W2', G, `          ) : (
            cancelButton && (
              <div className="flex shrink-0 justify-end">{cancelButton}</div>
            )
          )}`, `          ) : null}`],
];
const run = () => {
  const r = spawnSync('npx', ['vitest', 'run', 'client/components/managed/ManagedSessionsPage.test.tsx', 'client/components/managed/java-managed-agent-provider.test.ts'], { cwd: `${T}/packages/web-shell`, encoding: 'utf8', env: { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}` }, maxBuffer: 1 << 26 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const tests = out.match(/Tests\s+(\d+ failed \| )?\d+ passed \(\d+\)/)?.[0] ?? 'no-summary';
  const failed = [...out.matchAll(/^\s*(?:×|FAIL)\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 4);
  return { exit: r.status, tests, failed };
};
for (const [id, file, find, repl] of MUT) {
  let orig = null;
  if (file) { orig = fs.readFileSync(file, 'utf8'); const n = orig.split(find).length - 1; if (n !== 1) { console.log(`${id} ANCHOR=${n} SKIPPED`); continue; } fs.writeFileSync(file, orig.replace(find, repl)); }
  try { const res = run(); console.log(`${id} exit=${res.exit} ${res.tests} ${JSON.stringify(res.failed)}`); } finally { if (file) fs.writeFileSync(file, orig); }
}
