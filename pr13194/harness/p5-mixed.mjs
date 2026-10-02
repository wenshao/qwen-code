// VERIFICATION RIG ONLY (PR #13194): rolling-upgrade hazard. A DELETE admitted by the head binary is left LEASED by a killed
// head instance, and then an older (base) lifecycle coordinator is the one that picks it up.
// usage: DB=<db> BASE=... RUNDIR=... node p5-mixed.mjs admit <workspace> <storage-letter>
//        DB=<db> BASE=... RUNDIR=... node p5-mixed.mjs observe <workspace> <label> <seconds>
import fs from 'node:fs';
import {
  Report, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, sessStatus, j, LX, bindingOf, sql,
  del, opId, waitFor, opState, countEv, retirement, holdLock, lockWaits, genlogOn, genlogOff, genlogWrites, RUNTIME_TABLES, RIG, DB,
} from './lib94.mjs';

const [PHASE, WS = 'ws-mx', ARG = 'x', SECS = '120'] = process.argv.slice(2);
const F = `${RIG}/out/${DB}/mixed-${WS}.json`;
const K = (n) => `${n}-${Date.now().toString(36)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (PHASE === 'admit') {
  const rep = new Report(`p5-mixed-admit-${WS}`);
  ensureWorkspace(WS, `st-${ARG}`);
  const c = await createSession('public', WS, `G_FILES name=mx.txt tag=mx`);
  await waitTurn(c.session);
  const S = c.session;
  const r = await closeSession('public', S, { key: K('close') });
  await waitOp(S, opIdOf('public', r), { timeoutMs: 90_000 });
  const binding = bindingOf(S)[0]?.[0];
  const lock = holdLock(`SELECT state FROM qwen_managed_session_journal_head WHERE session_id='${S}' FOR UPDATE`, 40);
  await sleep(700);
  const d = await del('public', S, { key: K('del') });
  const op = opId('public', d);
  const held = await waitFor(() => lockWaits() > 0 && opState(op)?.[1] === 'LEASED', 10_000);
  const pid = LX(`cat /var/rig/run/${DB}/spring.pid`);
  LX(`kill -9 ${pid}`);
  lock.kill();
  await sleep(1500);
  rep.check('head admitted the DELETE, then died mid-completion; nothing committed', d.status === 202 && held.v && sessStatus(S) === 'DELETING' && retirement(S).length === 0, `op=${op} ${j(opState(op))} status=${sessStatus(S)}`);
  fs.writeFileSync(F, JSON.stringify({ S, op, binding, killedAt: Date.now() }));
  rep.done({ S, op, binding });
} else {
  const st = JSON.parse(fs.readFileSync(F, 'utf8'));
  const rep = new Report(`p5-mixed-observe-${WS}-${ARG}`);
  const g0 = genlogOn();
  const fin = await waitFor(() => ['COMPLETED', 'RECOVERY_BLOCKED', 'FAILED'].includes(opState(st.op)?.[0]), Number(SECS) * 1000, 500);
  await sleep(3000);
  const writes = genlogWrites(g0, RUNTIME_TABLES, [st.S, st.binding]);
  genlogOff();
  const o = opState(st.op);
  rep.note(`[${ARG}] operation after up to ${SECS} s`, `${j(o)} session=${sessStatus(st.S)} retirement=${retirement(st.S).length} deleted-events=${countEv(st.S, 'session.deleted')} waited=${(fin.ms / 1000).toFixed(1)} s`);
  rep.note(`[${ARG}] Runtime-table writes for this Session/binding while the older coordinator handled it`, `${writes.length}: ${writes.slice(0, 6).join(' | ')}`);
  const drains = sql(`SELECT COUNT(*) FROM qwen_runtime_harness_drain WHERE harness_session_id='${st.S}'`)[0][0];
  rep.note(`[${ARG}] drain fence rows`, drains);
  rep.done({ ...st, final: o, status: sessStatus(st.S), writes });
}
