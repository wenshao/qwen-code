// S4: Turn reads racing a Session delete on the real stack. Readers walk the
// Turn list (limit 2, each page re-checks the Session) and read details in a
// tight loop while the Session is deleted through the durable lifecycle.
// Checks: once a read answers 404, no later read answers 200 (no resurrection),
// and after the delete operation reports completed every read is 404.
// usage: node s4-delete-race.mjs <engine> [rounds]
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SP, OUT, openLog, say, sql, freshDb, startModel, startHarness, startSpring, api, createSession, waitFor, sleep } from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const ROUNDS = Number(process.argv[3] ?? 5);
const DB = `s4_pr_${ENGINE}`;
const B = { mysql: 19600, mariadb: 19700 }[ENGINE];
const P = { model: B + 1, harness: B + 2, spring: B + 3 };
openLog(`s4-race-${ENGINE}`);
freshDb(ENGINE, DB);
await startModel(P.model);
await startHarness(`s4-${ENGINE}`, P.harness, P.model);
await startSpring(`s4-${ENGINE}`, { jar: path.join(SP, 'jars', 'pr-server.jar'), engine: ENGINE, db: DB, port: P.spring, harnessPort: P.harness, storePort: P.spring });
const S = P.spring;
const done = async (sid, n) => waitFor(async () => Number(sql(ENGINE, DB, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}' AND status='COMPLETED'`)[0][0]) >= n, 90, 'turns');
const summary = [];
for (let round = 1; round <= ROUNDS; round++) {
  const sid = await createSession(S, { input: 'R0' });
  await done(sid, 1);
  for (let i = 2; i <= 6; i++) {
    await api(S, 'POST', `/v1/agents/sessions/${sid}/events`, { idem: randomUUID(), body: { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `R${i}` }] } });
    await done(sid, i);
  }
  const turnIds = sql(ENGINE, DB, `SELECT turn_id FROM managed_agent_turn WHERE session_id='${sid}'`).map((r) => r[0]);
  const log = [];
  let stop = false;
  const t0 = performance.now();
  const reader = async (k) => {
    while (!stop) {
      let cursor = null;
      do {
        const ts = performance.now() - t0;
        const r = await api(S, 'GET', `/v1/agents/sessions/${sid}/turns?limit=2${cursor ? '&cursor=' + cursor : ''}`);
        log.push({ ts, t: performance.now() - t0, kind: 'page', status: r.status, code: r.json?.error?.code });
        cursor = r.status === 200 ? r.json.next_cursor : null;
      } while (cursor && !stop);
      const ts = performance.now() - t0;
      const d = await api(S, 'GET', `/v1/agents/sessions/${sid}/turns/${turnIds[k % turnIds.length]}`);
      log.push({ ts, t: performance.now() - t0, kind: 'detail', status: d.status, code: d.json?.error?.code });
    }
  };
  const readers = [0, 1, 2, 3].map(reader);
  await sleep(300 + round * 37);
  const tDelete = performance.now() - t0;
  const del = await api(S, 'DELETE', `/v1/agents/sessions/${sid}`, { idem: randomUUID() });
  let tCompleted = null;
  const statuses = [];
  await waitFor(async () => {
    const o = await api(S, 'GET', `/v1/agents/sessions/${sid}/operations/${del.json.id}`);
    const s = await api(S, 'GET', `/v1/agents/sessions/${sid}`);
    statuses.push(`${s.status === 200 ? s.json.status : s.status + ' ' + s.json?.error?.code}`);
    if (o.json?.status === 'completed') {
      tCompleted = performance.now() - t0;
      return true;
    }
    return false;
  }, 120, 'delete operation');
  await sleep(1500);
  stop = true;
  await Promise.all(readers);
  const first404 = log.filter((e) => e.status === 404).sort((a, b) => a.t - b.t)[0];
  // A true step back: a 200 on a request that STARTED after another request had already RECEIVED a 404.
  const okAfter404 = first404 ? log.filter((e) => e.ts > first404.t && e.status === 200) : [];
  const lateOk = first404 ? log.filter((e) => e.t > first404.t && e.status === 200).map((e) => ({ startedBefore404By: +(first404.t - e.ts).toFixed(0), latency: +(e.t - e.ts).toFixed(0) })) : [];
  // Requests that STARTED after completion are those logged later than completion plus their own latency; use a 200 ms margin.
  const okAfterCompleted = log.filter((e) => e.ts > tCompleted && e.status === 200);
  const other = log.filter((e) => ![200, 404].includes(e.status) || (e.status === 404 && e.code !== 'session_not_found'));
  const row = {
    round, reads: log.length, ok: log.filter((e) => e.status === 200).length, notFound: log.filter((e) => e.status === 404).length,
    deleteAcceptedMs: +tDelete.toFixed(0), first404Ms: first404 ? +first404.t.toFixed(0) : null, completedMs: +tCompleted.toFixed(0),
    sessionStatuses: [...new Set(statuses)], okStartedAfterFirst404: okAfter404.length, okInFlightAcross404: lateOk, okAfterCompleted: okAfterCompleted.length, otherResponses: other.length,
  };
  summary.push(row);
  say('ROUND', JSON.stringify(row));
}
fs.writeFileSync(path.join(OUT, `s4-race-${ENGINE}.json`), JSON.stringify(summary, null, 2));
const bad = summary.filter((r) => r.okAfterCompleted || r.otherResponses || r.okStartedAfterFirst404);
say('SUMMARY', `${summary.length} rounds, ${summary.reduce((a, r) => a + r.reads, 0)} racing reads; rounds with a 200 started after a 404 or after completion, or an unexpected response: ${bad.length}`);
process.exit(0);
