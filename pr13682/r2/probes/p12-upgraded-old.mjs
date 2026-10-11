// VERIFICATION RIG ONLY (PR #13682 R2): after main 543f03e5 -> head (V66) on one database, rename every Session that
// main created (one with a FAILED/old command history included), then close one: the new delivery table must accept
// pre-upgrade Sessions and lifecycle must not be blocked by anything the upgrade left behind.
// usage: DB=<db> node p12-upgraded-old.mjs <workspace>
import { sql, one, api, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, status, renameCmds, delivery, journalTitles, harnessTitle, rename, short, until } from './lib13682.mjs';
const [WS] = process.argv.slice(2);
const r = new Report('p12-upgraded-old');
const rows = sql(`SELECT session_id, status, COALESCE(title,'<null>') FROM managed_agent_session WHERE tenant_id='${TENANT}' AND workspace_id='${WS}' AND status='ACTIVE' ORDER BY created_at`);
r.note('pre-upgrade ACTIVE Sessions in the workspace', j(rows));
r.note('delivery rows right after the upgrade', one(`SELECT COUNT(*) FROM managed_session_rename_delivery`));
let ok = 0;
for (const [S] of rows) {
  const before = renameCmds(S);
  const T = `Upgraded ${S.slice(-4)}`;
  const t0 = Date.now();
  const x = await rename(S, T, `u-${S}-${Date.now()}`);
  const settled = await until(() => { const d = delivery(S); return d && d !== 'n/a' && d[3] === 'COMPLETED'; }, { timeoutMs: 150_000, every: 250 });
  r.note(`delivery of ${S}`, settled.ok ? `COMPLETED at +${Date.now() - t0} ms (attempts ${delivery(S)[4]})` : `still ${j(delivery(S))} after ${Date.now() - t0} ms`);
  if (process.env.ALOG) {
    const fs = await import('node:fs');
    const lines = fs.readFileSync(process.env.ALOG, 'utf8').split('\n').filter((l) => l.includes(S) && l.includes('will retry'));
    r.note('A log retry failures', j(lines.map((l) => (l.match(/^(\S+)/)?.[1] ?? '') + ' ' + (l.split('failure=')[1] ?? '').slice(0, 150))));
  }
  const agree = dbTitle(S) === harnessTitle(S) && dbTitle(S) === T;
  if (settled.ok && agree) ok++;
  r.note(`rename ${S}`, `${short(x)}; earlier commands ${j(before)}; delivery ${j(delivery(S))}; public ${dbTitle(S)} / private ${harnessTitle(S)}; journal ${j(journalTitles(S).map((t) => `${t.title}@${t.managedRenameRevision ?? '-'}`))}`);
}
r.check('every pre-upgrade Session rename lands (inline or by recovery) with both titles equal', rows.length > 0 && ok === rows.length, `${ok}/${rows.length}`);
const S0 = rows[0]?.[0];
if (S0) {
  const cl = await api('POST', `/v1/agents/sessions/${S0}/close`, undefined, { actor: 'alice', key: `cl-${S0}-${Date.now()}` });
  const done = await until(() => status(S0) === 'CLOSED', { timeoutMs: 30_000 });
  r.check('a pre-upgrade Session closes after its rename', [200, 202].includes(cl.status) && done.ok, `${short(cl)} → ${status(S0)}`);
}
r.done({ rows, ok });
process.exit(0);
