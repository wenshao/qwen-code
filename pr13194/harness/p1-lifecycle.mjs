// VERIFICATION RIG ONLY (PR #13194): real Linux durable stack — files Session, real worker, reliable close (#13135),
// then L1 archive/unarchive and L2 delete through one surface, with a neighbour Session holding the same storage.
// usage: DB=<db> BASE=http://127.0.0.1:18136 RUNDIR=<rig>/run/lx-<db> node p1-lifecycle.mjs <public|web> <workspace> <storage-letter> <deleteFrom: ARCHIVED|CLOSED>
import {
  Report, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, bindingOf, handleOf, registration, procState, lxWs,
  fenceRows, resourcesOf, sessStatus, j, one, sql,
  archive, unarchive, del, read, opRead, opId, replayHdr, code, caps, waitOpDone, input, webTurn, warm, other,
  runtimeSnapshot, diffSnap, genlogOn, genlogOff, genlogWrites, RUNTIME_TABLES, events, countEv, ops, retirement, journalHead, unarchiveCommands,
} from './lib94.mjs';

const [SURF = 'public', WS = 'ws-p1', ST = 'a', FROM = 'ARCHIVED'] = process.argv.slice(2);
const OTHER = other(SURF);
const rep = new Report(`p1-${SURF}-${WS}-from${FROM}`);
ensureWorkspace(WS, `st-${ST}`);
const K = (n) => `${n}-${WS}-${Date.now().toString(36)}`;

// ---------- setup: target Session S and neighbour N on the same storage, both with real file Turns ----------
const c = await createSession(SURF, WS, `G_FILES name=proof.txt tag=${ST}`);
const S = c.session;
const t = await waitTurn(S);
rep.check('setup: bound files Session S runs a real file Turn', c.status === 202 && t.status === 'COMPLETED', `session=${S} turn=${t.status} file=${lxWs(ST, 'child/proof.txt')}`);
const n = await createSession(SURF, WS, `G_FILES name=neighbour.txt tag=${ST}n`);
const N = n.session;
const nt = await waitTurn(N);
rep.check('setup: neighbour Session N on the same storage runs a file Turn', nt.status === 'COMPLETED', `session=${N} file=${lxWs(ST, 'child/neighbour.txt')}`);
const resOf = (s) => { const [b] = bindingOf(s); const hd = b ? handleOf(b[0]) : null; const rid = hd?.resourceId ?? hd?.value?.resourceId; const reg = rid ? registration(rid) : null; return { binding: b, rid, pid: reg?.pid ?? 0, reg }; };
const sx = resOf(S); const nx = resOf(N);
rep.note('workers before close', `S pid=${sx.pid} (${procState(sx.pid)}) N pid=${nx.pid} (${procState(nx.pid)})`);
const capActive = caps(SURF, await read(SURF, S));
rep.check('ACTIVE Session advertises no archive/unarchive/delete', !capActive.archive && !capActive.unarchive && !capActive.delete, j(capActive));
const actA = await archive(SURF, S, { key: K('arch-active') });
const actD = await del(SURF, S, { key: K('del-active') });
rep.check('ACTIVE Session: archive and delete refused 409, nothing persisted', actA.status === 409 && actD.status === 409 && ops(S).length === 0, `archive=${actA.status}/${code(actA)} delete=${actD.status}/${code(actD)} ops=${ops(S).length}`);

// ---------- #13135 reliable close of S (real worker stop) ----------
const cl = await closeSession(SURF, S, { key: K('close') });
const clOp = opIdOf(SURF, cl);
const clw = await waitOp(S, clOp, { timeoutMs: 90_000, surface: SURF });
rep.check('close completes; S worker gone; binding RELEASED; fence persisted', clw.json.status === 'completed' && procState(sx.pid) === 'gone' && bindingOf(S)[0]?.[1] === 'RELEASED' && fenceRows(S) === 1,
  `op=${clw.json.status} pid ${sx.pid}=${procState(sx.pid)} binding=${bindingOf(S)[0]?.[1]} fence=${fenceRows(S)}`);
const closeReceipt = one(`SELECT receipt_id FROM managed_agent_operation WHERE operation_id='${clOp}'`);
rep.check('neighbour N worker still alive after S closed', procState(nx.pid) !== 'gone', `pid ${nx.pid}=${procState(nx.pid)}`);
const capClosed = caps(SURF, await read(SURF, S));
rep.check('CLOSED Session advertises archive/unarchive/delete', capClosed.archive === true && capClosed.unarchive === true && capClosed.delete === true, j(capClosed));
const wmN0 = warm(N);
rep.check('positive control: Runtime warm of ACTIVE neighbour N succeeds (so a warm refusal means something)', wmN0.status === 200, `status=${wmN0.status} ${wmN0.body.slice(0, 100)}`);
const resources0 = resourcesOf(S);
const evBefore = events(S).length;

// ---------- spy window starts: nothing below may touch Runtime/Harness/model ----------
await new Promise((r) => setTimeout(r, 1500));
const SB = bindingOf(S)[0]?.[0];
const snap0 = runtimeSnapshot(S, SB);
const gl0 = genlogOn();
const t0 = Date.now();

// ---------- L1 archive ----------
const bobA = await archive(SURF, S, { key: K('arch-bob'), actor: 'bob' });
const malA = await archive(SURF, S, { key: K('arch-mal'), actor: 'mallory' });
const xtA = await archive(SURF, S, { key: K('arch-xt'), tenant: 't-other' });
rep.check('archive: readable non-creator 403, unreadable 404, other tenant 404', bobA.status === 403 && malA.status === 404 && xtA.status === 404, `bob=${bobA.status}/${code(bobA)} mallory=${malA.status}/${code(malA)} tenant=${xtA.status}/${code(xtA)}`);
const kA1 = K('arch1');
const a1 = await archive(SURF, S, { key: kA1 });
const a1op = opId(SURF, a1);
rep.check('creator archive: 202 and the operation is already completed', a1.status === 202 && a1.json.status === 'completed', `status=${a1.status} op=${a1op} body.status=${a1.json.status} receipt=${a1.json.receipt_id ?? a1.json.receiptId}`);
rep.check('Session is ARCHIVED, session.archived event once', sessStatus(S) === 'ARCHIVED' && countEv(S, 'session.archived') === 1, `status=${sessStatus(S)} archived-events=${countEv(S, 'session.archived')}`);
const a1r = await archive(SURF, S, { key: kA1 });
const a1x = await archive(OTHER, S, { key: kA1 });
rep.check('archive replay (same surface and other surface) returns the original operation', opId(SURF, a1r) === a1op && opId(OTHER, a1x) === a1op && a1r.json.replayed === true, `same=${a1r.status}/${opId(SURF, a1r)} replayed=${a1r.json.replayed} other=${a1x.status}/${opId(OTHER, a1x)}`);
const a2 = await archive(SURF, S, { key: K('arch2') });
rep.check('fresh archive key on ARCHIVED Session refused 409', a2.status === 409, `status=${a2.status} code=${code(a2)}`);
const inA = await input(S, K('in-arch'));
const wbA = await webTurn(S, K('web-arch'));
const wmA = warm(S);
rep.note('ARCHIVED: public input / WebShell turn (refused for every bound Session on main, not evidence)', `input=${inA.status}/${code(inA)} webTurn=${wbA.status}/${code(wbA)}`);
rep.check('ARCHIVED: Runtime warm refused', wmA.status === 409, `input=${inA.status}/${code(inA)} webTurn=${wbA.status}/${code(wbA)} warm=${wmA.status} ${wmA.body.slice(0, 120)}`);

// ---------- L1 unarchive ----------
const bobU = await unarchive(SURF, S, { key: K('un-bob'), actor: 'bob' });
const malU = await unarchive(SURF, S, { key: K('un-mal'), actor: 'mallory' });
rep.check('unarchive: readable non-creator 403, unreadable 404', bobU.status === 403 && malU.status === 404, `bob=${bobU.status}/${code(bobU)} mallory=${malU.status}/${code(malU)}`);
const kU1 = K('un1');
const u1 = await unarchive(SURF, S, { key: kU1 });
rep.check('creator unarchive: 200, Session CLOSED, replay header false', u1.status === 200 && sessStatus(S) === 'CLOSED' && replayHdr(u1) === 'false', `status=${u1.status} body.status=${u1.json.status} db=${sessStatus(S)} replay=${replayHdr(u1)}`);
const evU = events(S).length;
const u1r = await unarchive(SURF, S, { key: kU1 });
const u1x = await unarchive(OTHER, S, { key: kU1 });
rep.check('unarchive replay on both surfaces: 200 replay=true, no new events, one command row', u1r.status === 200 && u1x.status === 200 && replayHdr(u1r) === 'true' && replayHdr(u1x) === 'true' && events(S).length === evU && unarchiveCommands(S) === 1,
  `same=${u1r.status}/${replayHdr(u1r)} other=${u1x.status}/${replayHdr(u1x)} events ${evU}->${events(S).length} commands=${unarchiveCommands(S)}`);
const u2 = await unarchive(SURF, S, { key: K('un2') });
rep.check('fresh unarchive key on a CLOSED Session refused 409', u2.status === 409, `status=${u2.status} code=${code(u2)}`);
const inU = await input(S, K('in-un'));
const wbU = await webTurn(S, K('web-un'));
const wmU = warm(S);
const clAgain = await closeSession(SURF, S, { key: K('close-again') });
rep.note('after unarchive: public input / WebShell turn (not evidence, see above)', `input=${inU.status}/${code(inU)} webTurn=${wbU.status}/${code(wbU)}`);
rep.check('after unarchive: Runtime warm still refused (permanent close fence)', wmU.status === 409, `input=${inU.status}/${code(inU)} webTurn=${wbU.status}/${code(wbU)} warm=${wmU.status} ${wmU.body.slice(0, 120)}`);
rep.note('fresh close key on the unarchived (CLOSED) Session', `status=${clAgain.status} code=${code(clAgain)} op.status=${clAgain.json.status ?? ''}`);
rep.check('close fence row and original close receipt unchanged', fenceRows(S) === 1 && one(`SELECT receipt_id FROM managed_agent_operation WHERE operation_id='${clOp}'`) === closeReceipt, `fence=${fenceRows(S)} receipt=${closeReceipt}`);
const capUn = caps(SURF, await read(SURF, S));
rep.check('unarchived Session still advertises archive/unarchive/delete', capUn.archive && capUn.unarchive && capUn.delete, j(capUn));

// ---------- replay after rearchive ----------
const a3 = await archive(SURF, S, { key: K('arch3') });
const u1late = await unarchive(SURF, S, { key: kU1 });
rep.check('old unarchive key after rearchive: 200 replay=true, returns ARCHIVED, does not unarchive', a3.status === 202 && u1late.status === 200 && replayHdr(u1late) === 'true' && /archived/i.test(u1late.json.status) && sessStatus(S) === 'ARCHIVED',
  `rearchive=${a3.status} replay=${u1late.status}/${replayHdr(u1late)} body.status=${u1late.json.status} db=${sessStatus(S)}`);
if (FROM === 'CLOSED') {
  const u3 = await unarchive(SURF, S, { key: K('un3') });
  rep.check('unarchive again so delete starts from CLOSED', u3.status === 200 && sessStatus(S) === 'CLOSED', `status=${u3.status} db=${sessStatus(S)}`);
}

// ---------- L2 delete ----------
const bobD = await del(SURF, S, { key: K('del-bob'), actor: 'bob' });
const malD = await del(SURF, S, { key: K('del-mal'), actor: 'mallory' });
rep.check('delete: readable non-creator 403, unreadable 404, nothing admitted', bobD.status === 403 && malD.status === 404 && !ops(S).some((o) => o[0] === 'DELETE'), `bob=${bobD.status}/${code(bobD)} mallory=${malD.status}/${code(malD)}`);
const kD1 = K('del1');
const tD = Date.now();
const d1 = await del(SURF, S, { key: kD1 });
const d1op = opId(SURF, d1);
rep.check(`creator delete from ${FROM}: 202`, d1.status === 202 && !!d1op, `status=${d1.status} op=${d1op} body.status=${d1.json.status}`);
const dw = await waitOpDone(SURF, S, d1op);
rep.check('delete operation completes', dw.json.status === 'completed', `status=${dw.json.status} ${Date.now() - tD} ms receipt=${dw.json.receipt_id ?? dw.json.receiptId}`);
const dRow = ops(S).find((o) => o[0] === 'DELETE');
rep.check('operation row: COMPLETED, session_status_before matches, receipt set, one claim', dRow?.[1] === 'COMPLETED' && dRow?.[3] === FROM && dRow?.[4] !== '' && dRow?.[5] === '1', j(dRow));
rep.check('tombstone: status DELETED, exactly one session.deleted event', sessStatus(S) === 'DELETED' && countEv(S, 'session.deleted') === 1, `status=${sessStatus(S)} deleted-events=${countEv(S, 'session.deleted')}`);
const ret = retirement(S);
rep.check('retirement barrier row written by this operation', ret.length === 1 && ret[0][0] === d1op, j(ret));
rep.note('journal head after delete', j(journalHead(S)));
const g1 = await read(SURF, S);
const g2 = await read(OTHER, S);
const ev = await (await import('../probe/lib.mjs')).api('GET', `/v1/agents/sessions/${S}/events?limit=10`);
rep.check('Session reads 404 on both surfaces; events 404', g1.status === 404 && g2.status === 404 && ev.status === 404, `${SURF}=${g1.status} ${OTHER}=${g2.status} events=${ev.status}`);
const o1 = await opRead(SURF, S, d1op);
const o2 = await opRead(OTHER, S, d1op);
const oa = await opRead(SURF, S, a1op);
rep.check('retained operations still readable on both surfaces after delete', o1.status === 200 && o2.status === 200 && oa.status === 200 && o1.json.status === 'completed', `delete-op ${SURF}=${o1.status} ${OTHER}=${o2.status} archive-op=${oa.status}`);
const d1r = await del(SURF, S, { key: kD1 });
const d1x = await del(OTHER, S, { key: kD1 });
rep.check('delete replay after tombstone (both surfaces) returns the original operation', opId(SURF, d1r) === d1op && opId(OTHER, d1x) === d1op, `same=${d1r.status}/${opId(SURF, d1r)} other=${d1x.status}/${opId(OTHER, d1x)}`);
const d2 = await del(SURF, S, { key: K('del2') });
const uDead = await unarchive(SURF, S, { key: kU1 });
const aDead = await archive(SURF, S, { key: kA1 });
rep.check('after tombstone: fresh delete 404, old unarchive key 404, old archive key still replays', d2.status === 404 && uDead.status === 404 && opId(SURF, aDead) === a1op, `delete2=${d2.status}/${code(d2)} unarchive=${uDead.status} archive-replay=${aDead.status}/${opId(SURF, aDead)}`);
const bobOp = await opRead(SURF, S, d1op, { actor: 'bob' });
const malOp = await opRead(SURF, S, d1op, { actor: 'mallory' });
rep.check('operation read after delete: reader 200, unreadable 404', bobOp.status === 200 && malOp.status === 404, `bob=${bobOp.status} mallory=${malOp.status}`);

// ---------- spy window ends ----------
const elapsed = Date.now() - t0;
await new Promise((r) => setTimeout(r, 1500));
const snap1 = runtimeSnapshot(S, SB);
const writes = genlogWrites(gl0, RUNTIME_TABLES, [S, SB]);
const writesAll = genlogWrites(gl0, RUNTIME_TABLES);
genlogOff();
const d = diffSnap(snap0, snap1);
rep.check('L1+L2: no Spring->Harness request, no model call, S Runtime rows/registrations/workers unchanged', d.length === 0, d.length ? d.join('; ') : `tap=${snap0.tap} model=${snap0.model} workers=[${snap0.workers}] over ${elapsed} ms`);
rep.note('global Runtime-table writes in the window (any Session, e.g. neighbour heartbeats)', `${writesAll.length} ${writesAll.slice(0, 3).join(' | ')}`);
rep.check('L1+L2: zero SQL writes to Runtime/lease/drain tables for S (MySQL general log)', writes.length === 0, writes.length ? writes.slice(0, 4).join(' | ') : `0 writes over ${elapsed} ms`);

// ---------- retained bytes and the neighbour ----------
rep.check('retained bytes: S file still on shared storage, history resource rows untouched', lxWs(ST, 'child/proof.txt') === `after-${ST}` && resourcesOf(S).length === resources0.length, `file=${lxWs(ST, 'child/proof.txt')} resources ${resources0.length}->${resourcesOf(S).length}`);
rep.check('neighbour N: same worker, ACTIVE, binding not drained', procState(nx.pid) !== 'gone' && sessStatus(N) === 'ACTIVE' && bindingOf(N)[0]?.[1] !== 'RELEASED', `pid ${nx.pid}=${procState(nx.pid)} status=${sessStatus(N)} binding=${bindingOf(N)[0]?.[1]}`);
const wmN1 = warm(N);
rep.check('neighbour N: Runtime warm still succeeds after S was deleted, same worker', wmN1.status === 200 && procState(nx.pid) !== 'gone', `warm=${wmN1.status} pid ${nx.pid}=${procState(nx.pid)}`);
const fresh = await createSession(SURF, WS, `G_FILES name=fresh.txt tag=${ST}f`);
const ft = await waitTurn(fresh.session);
rep.check('a new Session on the same storage runs a file Turn after delete', ft.status === 'COMPLETED', `session=${fresh.session} turn=${ft.status}`);
rep.note('operations of S', j(ops(S)));
rep.note('events of S (tail)', events(S).slice(-8).join(','));
rep.done({ S, N, fresh: fresh.session, close: clOp, archive: a1op, delete: d1op, snap0, snap1, writes, elapsedMs: elapsed });
