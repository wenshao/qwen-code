// VERIFICATION RIG ONLY (PR #13194): state/proof/authorization edges on the real Linux stack.
// usage: DB=<db> BASE=... RUNDIR=... node p2-edges.mjs <workspace> <storage-letter>
import {
  Report, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, bindingOf, handleOf, registration, procState, sessStatus, j, one, sql,
  archive, unarchive, del, read, opRead, opId, replayHdr, code, caps, waitOpDone, warm, setTapRules,
  ops, countEv, retirement, holdLock, waitFor, lockWaits, opState, revoke,
} from './lib94.mjs';

const [WS = 'ws-e', ST = 'e'] = process.argv.slice(2);
const rep = new Report(`p2-edges-${WS}`);
ensureWorkspace(WS, `st-${ST}`);
const K = (n) => `${n}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function filesSession(tag) {
  const c = await createSession('public', WS, `G_FILES name=${tag}.txt tag=${tag}`);
  await waitTurn(c.session);
  return c.session;
}
async function closedSession(tag) {
  const s = await filesSession(tag);
  const r = await closeSession('public', s, { key: K('close') });
  await waitOp(s, opIdOf('public', r), { timeoutMs: 90_000 });
  return s;
}
const pidOf = (s) => { const [b] = bindingOf(s); const hd = b ? handleOf(b[0]) : null; const rid = hd?.resourceId ?? hd?.value?.resourceId; return rid ? registration(rid)?.pid ?? 0 : 0; };

// ---- E1: manually seeded CLOSED / ARCHIVED without completed-close proof ----
const M = await filesSession('seeded');
const mpid = pidOf(M);
sql(`UPDATE managed_agent_session SET status='CLOSED' WHERE session_id='${M}'`);
const mcap = caps('public', await read('public', M));
const ma = await archive('public', M, { key: K('a') });
const md = await del('web', M, { key: K('d') });
rep.check('E1 seeded CLOSED (no close receipt, worker alive): capabilities false, archive and delete 409 workspace_unavailable', !mcap.archive && !mcap.delete && ma.status === 409 && code(ma) === 'workspace_unavailable' && md.status === 409 && code(md) === 'workspace_unavailable',
  `caps=${j(mcap)} archive=${ma.status}/${code(ma)} delete(web)=${md.status}/${code(md)} worker ${mpid}=${procState(mpid)}`);
sql(`UPDATE managed_agent_session SET status='ARCHIVED' WHERE session_id='${M}'`);
const mu = await unarchive('web', M, { key: K('u') });
const md2 = await del('public', M, { key: K('d') });
rep.check('E1 seeded ARCHIVED: unarchive and delete 409, no operation or command persisted', mu.status === 409 && md2.status === 409 && ops(M).length === 0, `unarchive(web)=${mu.status}/${code(mu)} delete=${md2.status}/${code(md2)} ops=${ops(M).length}`);
sql(`UPDATE managed_agent_session SET status='ACTIVE' WHERE session_id='${M}'`);
rep.check('E1 the seeded Session worker was never touched', procState(mpid) !== 'gone', `pid ${mpid}=${procState(mpid)}`);

// ---- E2: CLOSING (Harness close held 8 s by the tap) ----
const C = await filesSession('closing');
setTapRules([{ match: `DELETE /session/${C}`, action: 'delay', delayMs: 8000, times: 1 }]);
const cr = await closeSession('public', C, { key: K('close') });
const closing = await waitFor(() => sessStatus(C) === 'CLOSING', 10_000);
const ca = await archive('public', C, { key: K('a') });
const cu = await unarchive('web', C, { key: K('u') });
const cd = await del('public', C, { key: K('d') });
const ccap = caps('web', await read('web', C));
rep.check('E2 CLOSING: archive/unarchive/delete refused 409, capabilities false', closing.v && ca.status === 409 && cu.status === 409 && cd.status === 409 && !ccap.archive && !ccap.delete,
  `status=${sessStatus(C)} archive=${ca.status}/${code(ca)} unarchive=${cu.status}/${code(cu)} delete=${cd.status}/${code(cd)} caps=${j(ccap)}`);
const cw = await waitOp(C, opIdOf('public', cr), { timeoutMs: 90_000 });
setTapRules([]);
const ca2 = await archive('public', C, { key: K('a') });
rep.check('E2 after the held close completes, archive succeeds', cw.json.status === 'completed' && ca2.status === 202 && sessStatus(C) === 'ARCHIVED', `close=${cw.json.status} archive=${ca2.status} status=${sessStatus(C)}`);

// ---- E3: DELETING (completion held on the journal-head row lock) + ACL revocation after admission ----
const D = await closedSession('deleting');
const lock = holdLock(`SELECT state FROM qwen_managed_session_journal_head WHERE session_id='${D}' FOR UPDATE`, 15);
await sleep(700);
const kD = K('d');
const d1 = await del('public', D, { key: kD });
const d1op = opId('public', d1);
const held = await waitFor(() => lockWaits() > 0 && opState(d1op)?.[1] === 'LEASED', 8000);
rep.check('E3 delete admitted 202; completion is waiting on the held lock (op LEASED, Session DELETING)', d1.status === 202 && held.v && sessStatus(D) === 'DELETING', `op=${d1op} opState=${j(opState(d1op))} status=${sessStatus(D)} lockWaits=${lockWaits()}`);
const da = await archive('web', D, { key: K('a') });
const du = await unarchive('public', D, { key: K('u') });
const dd = await del('web', D, { key: K('d') });
const dr = await del('web', D, { key: kD });
rep.check('E3 DELETING: fresh archive/unarchive/delete 409; same key replays the open operation', da.status === 409 && du.status === 409 && dd.status === 409 && opId('web', dr) === d1op,
  `archive=${da.status}/${code(da)} unarchive=${du.status}/${code(du)} delete=${dd.status}/${code(dd)} replay=${dr.status}/${opId('web', dr)} replayed=${dr.json.replayed}`);
const gD = await read('public', D);
rep.note('E3 Session read while DELETING', `status=${gD.status} body.status=${gD.json.status ?? code(gD)}`);
revoke(WS, 'alice', false);
const rvOp = await opRead('public', D, d1op);
rep.check('E3 creator read revoked while deletion is in flight: operation read 404', rvOp.status === 404, `alice op read=${rvOp.status}`);
const lockExit = await lock.done;
const fin = await waitFor(() => opState(d1op)?.[0] === 'COMPLETED', 30_000);
rep.check('E3 accepted delete completes after the lock releases despite the ACL revocation', fin.v && sessStatus(D) === 'DELETED' && countEv(D, 'session.deleted') === 1 && retirement(D).length === 1, `lock exit=${lockExit} op=${j(opState(d1op))} status=${sessStatus(D)} +${fin.ms} ms`);
const bobOp = await opRead('web', D, d1op, { actor: 'bob' });
const aliceReplay = await del('public', D, { key: kD });
rep.check('E3 after completion: reader bob sees the operation; revoked creator replay hidden (404)', bobOp.status === 200 && bobOp.json.status === 'completed' && aliceReplay.status === 404, `bob=${bobOp.status}/${bobOp.json.status} alice replay=${aliceReplay.status}/${code(aliceReplay)}`);
revoke(WS, 'alice', true);
const aliceReplay2 = await del('public', D, { key: kD });
rep.check('E3 access restored: replay returns the original operation again', opId('public', aliceReplay2) === d1op, `status=${aliceReplay2.status} op=${opId('public', aliceReplay2)}`);

// ---- E4: revocation hides archive/unarchive replay ----
const R = await closedSession('revoke');
const kA = K('a');
const ra = await archive('public', R, { key: kA });
const raop = opId('public', ra);
revoke(WS, 'alice', false);
const r1 = await archive('public', R, { key: kA });
const r2 = await opRead('web', R, raop);
const r3 = await unarchive('public', R, { key: K('u') });
const r4 = await del('web', R, { key: K('d') });
rep.check('E4 creator without current read: archive replay, op read, unarchive, delete all 404', [r1, r2, r3, r4].every((x) => x.status === 404), `${r1.status},${r2.status},${r3.status},${r4.status}`);
const rb = await archive('public', R, { key: kA, actor: 'bob' });
rep.check('E4 reader bob reusing the creator key is a different request: 403, not a replay', rb.status === 403, `bob=${rb.status}/${code(rb)}`);
revoke(WS, 'alice', true);
const r5 = await archive('public', R, { key: kA });
rep.check('E4 access restored: archive replay returns the original operation', opId('public', r5) === raop && r5.json.replayed === true, `status=${r5.status} op=${opId('public', r5)}`);

// ---- E5: key validation and case-distinct keys ----
const bad = [];
for (const k of [' lead', 'trail ', 'ctl\u0001x', 'x'.repeat(300), '']) {
  // fetch trims header whitespace and refuses control characters, so the public header only carries the oversized/empty cases
  const r = k.length > 200 || k === '' ? await unarchive('public', R, { key: k }) : { status: 'n/a' };
  const w = await unarchive('web', R, { key: k });
  bad.push(`${JSON.stringify(k.slice(0, 8))}:${r.status}/${w.status}`);
}
rep.check('E5 malformed keys (whitespace, control, 300 chars, empty) rejected 400 on both surfaces, Session still ARCHIVED', bad.every((b) => /:(400|n\/a)\/400$/.test(b)) && sessStatus(R) === 'ARCHIVED', bad.join(' '));
const kUp = `CaseKey-${Date.now().toString(36)}`;
const u1 = await unarchive('public', R, { key: kUp });
const a2 = await archive('public', R, { key: K('a') });
const u2 = await unarchive('public', R, { key: kUp.toLowerCase() });
rep.check('E5 case-distinct keys are distinct commands (second unarchive mutates, not a replay)', u1.status === 200 && a2.status === 202 && u2.status === 200 && replayHdr(u2) === 'false' && sessStatus(R) === 'CLOSED',
  `u1=${u1.status}/${replayHdr(u1)} rearchive=${a2.status} u2=${u2.status}/${replayHdr(u2)} status=${sessStatus(R)}`);

// cleanup: close the seeded Session properly so its worker stops
const mc = await closeSession('public', M, { key: K('close') });
await waitOp(M, opIdOf('public', mc), { timeoutMs: 90_000 });
rep.note('cleanup: seeded Session closed', `status=${sessStatus(M)} worker ${mpid}=${procState(mpid)}`);
rep.done({ M, C, D, R, deleteOp: d1op });
