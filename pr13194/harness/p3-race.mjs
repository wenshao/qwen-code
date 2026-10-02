// VERIFICATION RIG ONLY (PR #13194): concurrent L1/L2 requests against the real Linux stack (Spring -> host MySQL 8.4).
// usage: DB=<db> BASE=... RUNDIR=... node p3-race.mjs <workspace> <storage-letter> <n>
import {
  Report, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, sessStatus, j,
  archive, unarchive, del, opId, replayHdr, code, waitFor, opState, ops, countEv, retirement, unarchiveCommands,
} from './lib94.mjs';

const [WS = 'ws-r', ST = 'r', NS = '16'] = process.argv.slice(2);
const N = Number(NS);
const rep = new Report(`p3-race-${WS}-n${N}`);
ensureWorkspace(WS, `st-${ST}`);
const K = (n) => `${n}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const surf = (i) => (i % 2 ? 'web' : 'public');
async function closedSession(tag) {
  const c = await createSession('public', WS, `G_FILES name=${tag}.txt tag=${tag}`);
  await waitTurn(c.session);
  const r = await closeSession('public', c.session, { key: K('close') });
  await waitOp(c.session, opIdOf('public', r), { timeoutMs: 90_000 });
  return c.session;
}
const tally = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});

// R1 distinct keys
const S1 = await closedSession('race1');
await archive('public', S1, { key: K('a') });
const ev0 = [countEv(S1, 'session.unarchive.requested'), countEv(S1, 'session.unarchived')];
const r1 = await Promise.all(Array.from({ length: N }, (_, i) => unarchive(surf(i), S1, { key: K(`u${i}`) })));
const won1 = r1.filter((r) => r.status === 200);
rep.check(`R1 ${N} concurrent unarchives, distinct keys, both surfaces: exactly one 200, the rest 409`, won1.length === 1 && replayHdr(won1[0]) === 'false' && r1.filter((r) => r.status === 409).length === N - 1,
  `statuses=${j(tally(r1))} codes409=${[...new Set(r1.filter((r) => r.status === 409).map(code))]}`);
rep.check('R1 one command row, one requested + one unarchived event, Session CLOSED', unarchiveCommands(S1) === 1 && countEv(S1, 'session.unarchive.requested') === ev0[0] + 1 && countEv(S1, 'session.unarchived') === ev0[1] + 1 && sessStatus(S1) === 'CLOSED',
  `commands=${unarchiveCommands(S1)} events=${countEv(S1, 'session.unarchive.requested')}/${countEv(S1, 'session.unarchived')} status=${sessStatus(S1)}`);

// R2 same key across both surfaces
await archive('web', S1, { key: K('a') });
const kSame = K('same');
const r2 = await Promise.all(Array.from({ length: N }, (_, i) => unarchive(surf(i), S1, { key: kSame })));
const fresh2 = r2.filter((r) => r.status === 200 && replayHdr(r) === 'false');
rep.check(`R2 ${N} concurrent unarchives, same key, both surfaces: all 200, exactly one non-replay`, r2.every((r) => r.status === 200) && fresh2.length === 1,
  `statuses=${j(tally(r2))} replay=false:${fresh2.length} true:${r2.filter((r) => replayHdr(r) === 'true').length}`);
rep.check('R2 command rows 2 in total, unarchived events 2 in total', unarchiveCommands(S1) === 2 && countEv(S1, 'session.unarchived') === ev0[1] + 2, `commands=${unarchiveCommands(S1)} unarchived=${countEv(S1, 'session.unarchived')}`);

// R3 concurrent archive, distinct keys
const S3 = await closedSession('race3');
const r3 = await Promise.all(Array.from({ length: N }, (_, i) => archive(surf(i), S3, { key: K(`a${i}`) })));
rep.check(`R3 ${N} concurrent archives, distinct keys: exactly one 202, the rest 409; one ARCHIVE operation`, r3.filter((r) => r.status === 202).length === 1 && ops(S3).filter((o) => o[0] === 'ARCHIVE').length === 1 && countEv(S3, 'session.archived') === 1,
  `statuses=${j(tally(r3))} archiveOps=${ops(S3).filter((o) => o[0] === 'ARCHIVE').length}`);

// R4 concurrent delete, distinct keys (from ARCHIVED)
const r4 = await Promise.all(Array.from({ length: N }, (_, i) => del(surf(i), S3, { key: K(`d${i}`) })));
const adm4 = r4.filter((r) => r.status === 202);
const op4 = adm4[0] ? opId(surf(r4.indexOf(adm4[0])), adm4[0]) : null;
const fin4 = op4 ? await waitFor(() => opState(op4)?.[0] === 'COMPLETED', 30_000) : { v: false };
rep.check(`R4 ${N} concurrent deletes, distinct keys: one admitted, one DELETE operation, one tombstone/event/retirement`, adm4.length === 1 && fin4.v && ops(S3).filter((o) => o[0] === 'DELETE').length === 1 && countEv(S3, 'session.deleted') === 1 && retirement(S3).length === 1,
  `statuses=${j(tally(r4))} deleteOps=${ops(S3).filter((o) => o[0] === 'DELETE').length} events=${countEv(S3, 'session.deleted')} retirement=${retirement(S3).length}`);

// R5 concurrent delete, same key (from CLOSED)
const S5 = await closedSession('race5');
const kD = K('dsame');
const r5 = await Promise.all(Array.from({ length: N }, (_, i) => del(surf(i), S5, { key: kD })));
const ids5 = new Set(r5.map((r, i) => opId(surf(i), r)));
const op5 = [...ids5][0];
const fin5 = await waitFor(() => opState(op5)?.[0] === 'COMPLETED', 30_000);
rep.check(`R5 ${N} concurrent deletes, same key, both surfaces: all 202 with one operation id; completes once`, r5.every((r) => r.status === 202) && ids5.size === 1 && fin5.v && countEv(S5, 'session.deleted') === 1 && retirement(S5).length === 1,
  `statuses=${j(tally(r5))} ids=${ids5.size} deleted-events=${countEv(S5, 'session.deleted')}`);

// R6 archive vs delete on the same CLOSED Session
const S6 = await closedSession('race6');
const r6 = await Promise.all(Array.from({ length: N }, (_, i) => (i % 2 ? del(surf(i), S6, { key: K(`d${i}`) }) : archive(surf(i), S6, { key: K(`a${i}`) }))));
const del6 = ops(S6).filter((o) => o[0] === 'DELETE');
if (del6.length) await waitFor(() => sessStatus(S6) === 'DELETED', 30_000);
rep.check(`R6 ${N / 2} archives racing ${N / 2} deletes: at most one of each kind admitted, final state consistent`, ops(S6).filter((o) => o[0] === 'ARCHIVE').length <= 1 && del6.length <= 1 && ['ARCHIVED', 'DELETED'].includes(sessStatus(S6)) && countEv(S6, 'session.deleted') === del6.length,
  `statuses=${j(tally(r6))} ops=${j(ops(S6).map((o) => o.slice(0, 4)))} final=${sessStatus(S6)}`);
rep.done({ S1, S3, S5, S6 });
