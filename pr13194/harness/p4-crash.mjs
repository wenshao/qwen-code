// VERIFICATION RIG ONLY (PR #13194): kill -9 Spring while a DELETE completion transaction is in flight, then restart
// with the Harness stopped, Runtime close support off (durable-local-process=false) and the Session's storage mount removed.
// usage: DB=<db> BASE=... RUNDIR=... node p4-crash.mjs <workspace> <storage-letter> <jar-label> <dist-label>
import {
  Report, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, sessStatus, j, one, sql, LX,
  archive, unarchive, del, read, opRead, opId, replayHdr, code, caps, waitFor, opState, ops, countEv, retirement, journalHead, holdLock, lockWaits,
} from './lib94.mjs';

const [WS = 'ws-k', ST = 'k', JAR = 'p94head', DIST = 'p94head'] = process.argv.slice(2);
const rep = new Report(`p4-crash-${WS}-${JAR}`);
ensureWorkspace(WS, `st-${ST}`);
const DBN = process.env.DB;
const K = (n) => `${n}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RIG = '/Users/wenshao/pr13135-rig';
async function closedSession(tag) {
  const c = await createSession('public', WS, `G_FILES name=${tag}.txt tag=${tag}`);
  await waitTurn(c.session);
  const r = await closeSession('public', c.session, { key: K('close') });
  await waitOp(c.session, opIdOf('public', r), { timeoutMs: 90_000 });
  return c.session;
}
const X = await closedSession('crash');
const Y = await closedSession('norun');
const Y2 = await closedSession('norun2');
rep.note('prepared CLOSED Sessions', `X=${X} Y=${Y} Y2=${Y2} statuses=${sessStatus(X)}/${sessStatus(Y)}/${sessStatus(Y2)}`);

// 1. hold the journal head so the completion transaction blocks after taking the tenant lock
const lock = holdLock(`SELECT state FROM qwen_managed_session_journal_head WHERE session_id='${X}' FOR UPDATE`, 40);
await sleep(700);
const kD = K('del');
const d = await del('public', X, { key: kD });
const op = opId('public', d);
const held = await waitFor(() => lockWaits() > 0 && opState(op)?.[1] === 'LEASED', 10_000);
rep.check('delete admitted; coordinator claimed it and is blocked inside completion', d.status === 202 && held.v, `op=${op} state=${j(opState(op))} lockWaits=${lockWaits()}`);

// 2. kill -9 Spring mid-transaction
const springPid = LX(`cat /var/rig/run/${DBN}/spring.pid`);
LX(`kill -9 ${springPid}; sleep 1; kill -0 ${springPid} 2>/dev/null && echo alive || echo dead`);
const tKill = Date.now();
lock.kill();
await sleep(1500);
const after = { op: opState(op), status: sessStatus(X), retirement: retirement(X).length, deleted: countEv(X, 'session.deleted'), head: journalHead(X)?.[0] };
rep.check('after kill -9: nothing of the completion committed (DELETING, op still LEASED by the dead owner, no retirement/tombstone/event)',
  after.status === 'DELETING' && after.op?.[1] === 'LEASED' && after.retirement === 0 && after.deleted === 0 && after.head !== 'DELETED', j(after));

// 3. stop the Harness too, then restart Spring with no Runtime close support and without this storage's mount
LX(`${RIG}/lx/stop.sh ${DBN} harness`);
const harnessGone = LX(`[ -f /var/rig/run/${DBN}/harness.pid ] && echo present || echo none`);
const up = LX(`DIST=${DIST} DURABLE=false NOMOUNT=${ST} ${RIG}/lx/spring.sh ${JAR} ${DBN} 2>&1 | tail -1`);
rep.note('restart', `harness pid file=${harnessGone}; spring: ${up}`);
const capY = caps('public', await read('public', Y));
rep.check('restarted instance (no Harness, durable off, mount removed) still advertises archive/unarchive/delete for a closed Session', capY.archive && capY.unarchive && capY.delete, j(capY));

// 4. takeover after the dead owner's lease expires
const fin = await waitFor(() => opState(op)?.[0] === 'COMPLETED', 150_000, 500);
const final = { op: opState(op), status: sessStatus(X), retirement: retirement(X), deleted: countEv(X, 'session.deleted'), head: journalHead(X)?.[0] };
rep.check('takeover completes the delete exactly once (claim generation 2, one retirement, one event, tombstone)',
  fin.v && final.op?.[2] === '2' && final.status === 'DELETED' && final.retirement.length === 1 && final.retirement[0][0] === op && final.deleted === 1 && final.head === 'DELETED',
  `${j(final)} completed ${((Date.now() - tKill) / 1000).toFixed(1)} s after the kill`);
const rp = await del('web', X, { key: kD });
rep.check('replay after takeover returns the original operation', opId('web', rp) === op && rp.json.status === 'completed', `status=${rp.status} op=${opId('web', rp)} state=${rp.json.status}`);

// 5. metadata operations on this no-Runtime instance
const ya = await archive('web', Y, { key: K('a') });
const yu = await unarchive('public', Y, { key: K('u') });
const yd = await del('web', Y, { key: K('d') });
const yop = opId('web', yd);
const yfin = await waitFor(() => opState(yop)?.[0] === 'COMPLETED', 30_000);
rep.check('no Harness / no Runtime close support / no mount: archive 202, unarchive 200, delete completes', ya.status === 202 && yu.status === 200 && yfin.v && sessStatus(Y) === 'DELETED',
  `archive=${ya.status} unarchive=${yu.status} delete=${yd.status} ${j(opState(yop))} status=${sessStatus(Y)} in ${yfin.ms} ms`);
const ya2 = await archive('public', Y2, { key: K('a') });
const yd2 = await del('public', Y2, { key: K('d') });
const y2fin = await waitFor(() => sessStatus(Y2) === 'DELETED', 30_000);
rep.check('same instance: archive then delete from ARCHIVED completes', ya2.status === 202 && yd2.status === 202 && y2fin.v, `archive=${ya2.status} delete=${yd2.status} status=${sessStatus(Y2)}`);
const z = await createSession('public', WS, 'PLAIN no harness');
rep.note('new Workspace Session on this instance (Harness down, mount removed)', `status=${z.status} code=${code(z)}`);

// 6. restore the normal stack
LX(`${RIG}/lx/stop.sh ${DBN} spring`);
const up2 = LX(`DIST=${DIST} ${RIG}/lx/spring.sh ${JAR} ${DBN} 2>&1 | tail -1`);
const hup = LX(`${RIG}/lx/harness.sh ${DBN} ${DIST} 2>&1 | tail -1`);
rep.note('stack restored', `${up2} | ${hup}`);
rep.done({ X, Y, Y2, op });
