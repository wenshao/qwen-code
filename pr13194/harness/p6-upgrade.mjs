// VERIFICATION RIG ONLY (PR #13194): Sessions closed by the base (main) binary, then L1/L2 after swapping in the head jar on the same DB.
// usage: DB=<db> BASE=... RUNDIR=... node p6-upgrade.mjs prep|after <workspace> <storage-letter>
import fs from 'node:fs';
import {
  Report, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, sessStatus, j, bindingOf, handleOf, registration, procState,
  archive, unarchive, del, read, opId, replayHdr, code, caps, waitFor, opState, countEv, retirement, RIG, DB,
} from './lib94.mjs';

const [PHASE, WS = 'ws-up', ST = 'u'] = process.argv.slice(2);
const F = `${RIG}/out/${DB}/upgrade-${WS}.json`;
const K = (n) => `${n}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const rep = new Report(`p6-upgrade-${PHASE}-${WS}`);
const pidOf = (s) => { const [b] = bindingOf(s); const hd = b ? handleOf(b[0]) : null; const rid = hd?.resourceId ?? hd?.value?.resourceId; return rid ? registration(rid)?.pid ?? 0 : 0; };
if (PHASE === 'prep') {
  ensureWorkspace(WS, `st-${ST}`);
  const out = {};
  for (const tag of ['u1', 'u2']) {
    const c = await createSession(tag === 'u1' ? 'public' : 'web', WS, `G_FILES name=${tag}.txt tag=${tag}`);
    await waitTurn(c.session);
    const r = await closeSession('public', c.session, { key: K('close') });
    const w = await waitOp(c.session, opIdOf('public', r), { timeoutMs: 90_000 });
    out[tag] = c.session;
    rep.check(`base binary: ${tag} closed`, w.json.status === 'completed' && sessStatus(c.session) === 'CLOSED', `${c.session}`);
  }
  const a = await createSession('public', WS, 'G_FILES name=u3.txt tag=u3');
  await waitTurn(a.session);
  out.u3 = a.session;
  out.u3pid = pidOf(a.session);
  rep.check('base binary: u3 left ACTIVE with a live worker', sessStatus(a.session) === 'ACTIVE' && procState(out.u3pid) !== 'gone', `pid=${out.u3pid}`);
  fs.writeFileSync(F, JSON.stringify(out));
  rep.done(out);
} else {
  const s = JSON.parse(fs.readFileSync(F, 'utf8'));
  const c1 = caps('public', await read('public', s.u1));
  const c2 = caps('web', await read('web', s.u2));
  rep.check('head binary: Sessions closed by the base binary advertise archive/unarchive/delete', c1.archive && c1.delete && c2.archive && c2.delete, `u1=${j(c1)} u2=${j(c2)}`);
  const a = await archive('public', s.u1, { key: K('a') });
  const u = await unarchive('web', s.u1, { key: K('u') });
  const a2 = await archive('web', s.u1, { key: K('a') });
  const d = await del('public', s.u1, { key: K('d') });
  const f1 = await waitFor(() => sessStatus(s.u1) === 'DELETED', 30_000);
  rep.check('u1 (closed by base): archive 202, unarchive 200, rearchive 202, delete from ARCHIVED completes', a.status === 202 && u.status === 200 && a2.status === 202 && d.status === 202 && f1.v && retirement(s.u1).length === 1,
    `archive=${a.status} unarchive=${u.status} rearchive=${a2.status} delete=${d.status} final=${sessStatus(s.u1)}`);
  const d2 = await del('web', s.u2, { key: K('d') });
  const f2 = await waitFor(() => sessStatus(s.u2) === 'DELETED', 30_000);
  rep.check('u2 (closed by base): delete from CLOSED completes', d2.status === 202 && f2.v && countEv(s.u2, 'session.deleted') === 1, `delete=${d2.status} final=${sessStatus(s.u2)}`);
  rep.note('u3 worker after the binary swap', `pid ${s.u3pid}=${procState(s.u3pid)} status=${sessStatus(s.u3)}`);
  const cl = await closeSession('public', s.u3, { key: K('close') });
  const cw = await waitOp(s.u3, opIdOf('public', cl), { timeoutMs: 90_000 });
  rep.check('u3 (ACTIVE under base): head closes it and stops the base-era worker', cw.json.status === 'completed' && procState(s.u3pid) === 'gone', `close=${cw.json.status} pid ${s.u3pid}=${procState(s.u3pid)}`);
  const d3 = await del('public', s.u3, { key: K('d') });
  const f3 = await waitFor(() => sessStatus(s.u3) === 'DELETED', 30_000);
  rep.check('u3: delete after the head-side close completes', d3.status === 202 && f3.v, `delete=${d3.status} final=${sessStatus(s.u3)}`);
  rep.done(s);
}
