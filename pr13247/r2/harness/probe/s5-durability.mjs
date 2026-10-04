// VERIFICATION RIG ONLY (PR #13247) S5: transient-failure retry, crash windows, mid-settlement fact changes.
// Requires probe/traps.sql installed in the DB. Restarts Spring (and the Harness) by recorded PID only.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Report, register, ensureWorkspace, createSession, waitTurn, sleep, j, sql, one, RUN, RIG, TENANT, DB, WS, ST } from './lib.mjs';
import { pubChange, webChange, opId, pubOp, waitCwdOp, binding, cwdOpRow, ctxEvents, mkdirWs, openOps } from './cwd.mjs';

const R = new Report('s5-durability');
const JAR = process.env.JAR ?? 'head';
const sh = (...a) => spawnSync('bash', a, { encoding: 'utf8', cwd: RIG });
const restart = (sig = 'KILL') => {
  const t0 = Date.now();
  sh(`${RIG}/stop.sh`, DB, 'spring', sig);
  const up = sh(`${RIG}/spring.sh`, JAR, DB, 'absent', 'absent');
  return { up: up.stdout.trim().split('\n').at(-1), ms: Date.now() - t0 };
};
const restartHarness = () => { sh(`${RIG}/stop.sh`, DB, 'harness'); return sh(`${RIG}/harness.sh`, DB, process.env.DIST ?? 'head').stdout.trim().split('\n').at(-1); };
const tag = Date.now() % 100000;
ensureWorkspace(WS, `st-${ST}`);
const root = fs.realpathSync(`${RUN}/ws/${ST}`);
const mk = async (ws = WS) => { const x = await createSession('public', ws, 'PLAIN'); await waitTurn(x.session); return x.session; };

R.say('## A. transient commit failure → retried with backoff, completes once');
{
  const s = await mk();
  mkdirWs(ST, `trap-fail-${tag}`);
  const a = await pubChange(s, `trap-fail-${tag}`, 1, { key: `s5a-${tag}` });
  await sleep(300);
  const mid = cwdOpRow(opId(a));
  const midRead = await pubOp(s, opId(a));
  const busy = await pubChange(s, 'child', 1, { key: `s5a2-${tag}` });
  R.check('after the first injected failure the operation is open (pending/installing) and the Session refuses another change', mid.state !== 'COMPLETED' && mid.state !== 'FAILED' && ['pending', 'installing'].includes(midRead.json.status) && busy.status === 409 && busy.json.error?.code === 'session_context_busy', `row=${j(mid)} read=${midRead.json.status} other=${busy.status} ${busy.json.error?.code}`);
  const w = await waitCwdOp(s, opId(a), { timeoutMs: 30_000 });
  const row = cwdOpRow(opId(a));
  R.check('completes after two injected failures (attempt_count=2), rev 1→2, exactly one event', w.json.status === 'completed' && row.attempts === 2 && binding(s).rev === 2 && ctxEvents(s).length === 1, `${w.ms} ms row=${j(row)} events=${ctxEvents(s).length}`);
}

R.say('## B. kill -9 Spring inside the commit transaction (after the probe passed)');
{
  const s = await mk();
  mkdirWs(ST, `trap-slow-${tag}`);
  const b0 = binding(s);
  const a = await pubChange(s, `trap-slow-${tag}`, 1, { key: `s5b-${tag}` });
  const op = opId(a);
  let seen = null;
  for (let i = 0; i < 40 && !seen; i++) { const r = await pubOp(s, op); if (r.json.status === 'installing') seen = r.json; else await sleep(100); }
  await sleep(1500);
  const during = binding(s);
  R.check('while the commit is held: operation reads "installing", Session still reads the old (cwd, revision)', seen?.status === 'installing' && during.cwd === b0.cwd && during.rev === 1, `op=${seen?.status} binding=${j(during)}`);
  const t0 = Date.now();
  const rs = restart('KILL');
  R.note('Spring kill -9 + restart', `${rs.up} in ${rs.ms} ms`);
  const w = await waitCwdOp(s, op, { timeoutMs: 120_000 });
  const row = cwdOpRow(op);
  R.check('reclaimed after the lease and committed exactly once (claim generation 2, one event, rev 2)', w.json.status === 'completed' && row.gen === 2 && binding(s).rev === 2 && binding(s).cwd === `trap-slow-${tag}` && ctxEvents(s).length === 1, `completed ${((Date.now() - t0) / 1000).toFixed(1)} s after the kill row=${j(row)} events=${ctxEvents(s).length}`);
}

R.say('## C. kill -9 Spring inside the claim (before the probe)');
{
  const s = await mk();
  mkdirWs(ST, `trap-claim-c-${tag}`);
  const a = await pubChange(s, `trap-claim-c-${tag}`, 1, { key: `s5c-${tag}` });
  await sleep(1000);
  const before = cwdOpRow(opId(a));
  const t0 = Date.now();
  const rs = restart('KILL');
  R.note('Spring kill -9 + restart', `row before kill ${j(before)}; ${rs.up} in ${rs.ms} ms`);
  const w = await waitCwdOp(s, opId(a), { timeoutMs: 120_000 });
  const row = cwdOpRow(opId(a));
  R.check('PENDING row survives the crash and completes once after restart', w.json.status === 'completed' && binding(s).rev === 2 && ctxEvents(s).length === 1, `completed ${((Date.now() - t0) / 1000).toFixed(1)} s after the kill row=${j(row)}`);
}
R.note('Harness restart (Spring restarted twice)', restartHarness());

R.say('## D. facts move between claim and commit (claim held 4 s)');
const WS5 = `ws-s5-${tag}`;
register(WS5, 'st-c');
const croot = fs.realpathSync(`${RUN}/ws/c`);
const outside = `${RUN}/outside-s5-${tag}`;
fs.mkdirSync(outside, { recursive: true });
const D = [
  ['creator loses can_create', () => sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}' AND actor_id='alice'`), () => sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}' AND actor_id='alice'`)],
  ['creator loses can_read', () => sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}' AND actor_id='alice'`), () => sql(`UPDATE managed_workspace_access SET can_read=TRUE WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}' AND actor_id='alice'`)],
  ['registry → DRAINING', () => sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}'`), () => sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}'`)],
  ['registry generation bump', () => sql(`UPDATE managed_workspace_registry SET workspace_generation=2 WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}'`), () => sql(`UPDATE managed_workspace_registry SET workspace_generation=1 WHERE tenant_id='${TENANT}' AND workspace_id='${WS5}'`)],
  ['target directory removed', (d) => fs.rmSync(`${croot}/${d}`, { recursive: true }), () => {}],
  ['target directory replaced by a symlink to outside', (d) => { fs.rmSync(`${croot}/${d}`, { recursive: true }); fs.symlinkSync(outside, `${croot}/${d}`); }, () => {}],
];
for (const [i, [label, act, undo]] of D.entries()) {
  const s = await mk(WS5);
  const d = `trap-claim-d${i}-${tag}`;
  mkdirWs('c', d);
  const b0 = binding(s);
  const a = await pubChange(s, d, 1, { key: `s5d${i}-${tag}` });
  await sleep(800);
  act(d);
  const w = await waitCwdOp(s, opId(a), { timeoutMs: 20_000 });
  undo(d);
  const b1 = binding(s);
  const again = await pubChange(s, 'child', 1, { key: `s5d${i}b-${tag}` });
  const w2 = again.status === 202 ? await waitCwdOp(s, opId(again)) : again;
  R.check(`${label} → failed ${w.json.failure_code}; Session keeps (cwd, rev); a later change still works`, w.json.status === 'failed' && w.json.failure_code === 'workspace_unavailable' && b1.cwd === b0.cwd && b1.rev === b0.rev && w2.json.status === 'completed' && ctxEvents(s).length === 1, `${w.ms} ms ${w.json.status}/${w.json.failure_code} binding ${j(b0)}→${j(b1)} next=${again.status}/${w2.json.status}`);
}

R.say('## E. directory swapped for a symlink AFTER the probe, inside the commit (commit held 15 s)');
{
  sql(`UPDATE rig_trap SET secs=6 WHERE name='commit'`);
  const s = await mk();
  const d = `trap-slow-e-${tag}`;
  mkdirWs(ST, d);
  const a = await pubChange(s, d, 1, { key: `s5e-${tag}` });
  await sleep(1500);
  fs.rmSync(`${root}/${d}`, { recursive: true });
  fs.symlinkSync(outside, `${root}/${d}`);
  const w = await waitCwdOp(s, opId(a), { timeoutMs: 30_000 });
  R.note('commit does not re-probe: the swapped path is committed (the next turn’s acquire is the guard)', `${w.json.status} rev=${binding(s).rev} cwd=${binding(s).cwd} isSymlink=${fs.lstatSync(`${root}/${d}`).isSymbolicLink()}`);
  sql(`UPDATE rig_trap SET secs=15 WHERE name='commit'`);
  fs.writeFileSync(`${RIG}/out/${DB}/s5e-session.txt`, `${s} ${d}\n`);
}
R.done({});
