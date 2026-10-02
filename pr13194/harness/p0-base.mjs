// VERIFICATION RIG ONLY (PR #13194): BEFORE — the same close -> archive/unarchive/delete sequence against the base (main) jar.
// usage: DB=<db> BASE=... RUNDIR=... node p0-base.mjs <workspace> <storage-letter>
import {
  Report, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, sessStatus, j, procState, bindingOf,
  archive, unarchive, del, read, code, ops,
} from './lib94.mjs';

const [WS = 'ws-b0', ST = 'm'] = process.argv.slice(2);
const rep = new Report(`p0-base-${WS}`);
ensureWorkspace(WS, `st-${ST}`);
const K = (n) => `${n}-${Date.now().toString(36)}`;
for (const surf of ['public', 'web']) {
  const c = await createSession(surf, WS, `G_FILES name=${surf}.txt tag=${surf}`);
  const t = await waitTurn(c.session);
  const S = c.session;
  const cl = await closeSession(surf, S, { key: K('close') });
  const w = await waitOp(S, opIdOf(surf, cl), { timeoutMs: 90_000, surface: surf });
  rep.check(`[${surf}] base: file Turn + reliable close complete`, t.status === 'COMPLETED' && w.json.status === 'completed' && sessStatus(S) === 'CLOSED', `turn=${t.status} close=${w.json.status} binding=${bindingOf(S)[0]?.[1]}`);
  const capsRaw = (await read(surf, S)).json.capabilities;
  rep.note(`[${surf}] base capabilities of the CLOSED Session`, j(capsRaw));
  const a = await archive(surf, S, { key: K('a') });
  const u = await unarchive(surf, S, { key: K('u') });
  const d = await del(surf, S, { key: K('d') });
  rep.check(`[${surf}] base: archive refused 409 workspace_unavailable`, a.status === 409 && code(a) === 'workspace_unavailable', `archive=${a.status}/${code(a)}`);
  rep.check(`[${surf}] base: delete refused 409 workspace_unavailable`, d.status === 409 && code(d) === 'workspace_unavailable', `delete=${d.status}/${code(d)}`);
  rep.note(`[${surf}] base: unarchive`, `status=${u.status} code=${code(u)} raw=${JSON.stringify(u.json).slice(0, 120)}`);
  rep.check(`[${surf}] base: Session stays CLOSED with only the CLOSE operation`, sessStatus(S) === 'CLOSED' && ops(S).length === 1, `status=${sessStatus(S)} ops=${j(ops(S).map((o) => o[0]))}`);
}
rep.done();
