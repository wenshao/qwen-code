// VERIFICATION RIG ONLY (PR #13179): the Session a panel is watching is deleted by its owner elsewhere.
// K pages per arm watch it; alice deletes it through the adapter; every request of every page is recorded for WATCH_S.
import fs from 'node:fs';
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, RIG, DB, api, sql } from './lib.mjs';
import { launch, open, alertText, shot, counts, gaps, sleep } from './ui.mjs';
const K = Number(process.env.K ?? 2);
const WATCH_S = Number(process.env.WATCH_S ?? 240);
const r = new Report('u2-deleted');
ensureWorkspace(WS, `st-${ST}`);
// Workspace-bound Sessions cannot be closed or deleted in this build (409 workspace_unavailable), so the
// watched Session is a plain (unbound) one, which the server really closes and deletes.
const made = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'UI_STREAM n=5 delay=20 tag=DEL' }] }, { key: `del-${Date.now()}` });
const c = { session: made.json.id };
const t = await waitTurn(c.session);
r.check('turn completed', t.status === 'COMPLETED', j(t));
const b = await launch();
const pages = [];
for (let i = 0; i < K; i++) for (const arm of (process.env.ARMS ?? 'base,head').split(',')) pages.push({ ...(await open(b, { arm, session: c.session, scale: i === 0 ? 2 : 1 })), i });
for (const p of pages) await p.page.getByText('[DEL-0005]').first().waitFor({ timeout: 30_000 });
await sleep(8000);
const tDel0 = Date.now();
// An active Session must be closed before it can be deleted (409 session_state_conflict otherwise).
async function lifecycle(kind) {
  const x = await api('POST', `/api/agent/web-shell/v1/sessions/${kind}`, { sessionId: c.session, idempotencyKey: `${kind}-${Date.now()}` });
  r.note(`${kind} admitted`, `${x.status} ${JSON.stringify(x.json).slice(0, 200)}`);
  const op = x.json.operationId ?? x.json.id;
  for (let i = 0; op && i < 150; i++) {
    const q = await api('POST', '/api/agent/web-shell/v1/operations/query', { sessionId: c.session, operationId: op });
    if (['completed', 'failed'].includes(q.json.status)) { r.note(`${kind} operation`, `${q.json.status} ${JSON.stringify(q.json).slice(0, 200)}`); return q.json.status; }
    await sleep(200);
  }
  return 'unknown';
}
const closed = await lifecycle('close');
r.note('session row after close', j(sql(`SELECT status FROM managed_agent_session WHERE session_id='${c.session}'`).at(0) ?? 'no row'));
const tClose = Date.now();
await sleep(5000);
const del = await lifecycle('delete');
let gone;
const tProbe = Date.now();
for (let i = 0; i < 100; i++) { const g = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: c.session }); if (g.status !== 200) { gone = { status: g.status, ms: Date.now() - tProbe, body: JSON.stringify(g.json).slice(0, 160) }; break; } await sleep(200); }
r.check('the Session reads as gone after the delete', Boolean(gone), j(gone));
const tDel = Date.now() - (gone?.ms ?? 0);
const tr = await api('POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: c.session, limit: 100 });
r.note('transcript leg after delete', `${tr.status} ${JSON.stringify(tr.json).slice(0, 160)}`);
r.note('session row after delete', j(sql(`SELECT status FROM managed_agent_session WHERE session_id='${c.session}'`).at(0) ?? 'no row'));
for (let s = 1; s <= WATCH_S; s++) {
  await sleep(1000);
  if (s === 60 || s === WATCH_S) for (const p of pages.filter((x) => x.i === 0)) await shot(p.page, `u2-${p.arm}-${s}s`);
}
const tEnd = Date.now();
const rows = [];
for (const p of pages) {
  const after = p.net.filter((e) => e.t >= tDel && e.t < tEnd);
  const byMin = [0, 1, 2, 3].map((m) => after.filter((e) => e.t >= tDel + m * 60000 && e.t < tDel + (m + 1) * 60000).length);
  const row = {
    arm: p.arm, i: p.i,
    requests: after.length, byPath: counts(after), perMinute: byMin,
    statuses: [...new Set(after.map((e) => `${e.path}:${e.status ?? e.failed}`))],
    sessionsGetGapsS: gaps(after.filter((e) => e.path === '/sessions/get').map((e) => e.t)).map((g) => +(g / 1000).toFixed(1)),
    lastStreamS: after.filter((e) => e.path === '/events/stream').length ? +((after.filter((e) => e.path === '/events/stream').at(-1).t - tDel) / 1000).toFixed(1) : null,
    alerts: await alertText(p.page),
  };
  rows.push(row);
  r.say(`ROW ${JSON.stringify(row)}`);
}
for (const arm of (process.env.ARMS ?? 'base,head').split(',')) {
  const a = rows.filter((x) => x.arm === arm);
  r.note(`${arm}: requests per page after delete (${WATCH_S}s)`, j(a.map((x) => x.requests)));
  r.note(`${arm}: per-minute`, j(a.map((x) => x.perMinute)));
  r.note(`${arm}: alerts`, j(a.map((x) => x.alerts)));
}
fs.writeFileSync(`${RIG}/out/${DB}/u2-net.json`, JSON.stringify({ tDel, tEnd, pages: pages.map((p) => ({ arm: p.arm, i: p.i, net: p.net })) }));
await b.close();
r.done({ session: c.session, rows });
