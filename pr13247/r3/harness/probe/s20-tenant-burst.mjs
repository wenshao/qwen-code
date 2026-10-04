// VERIFICATION RIG ONLY (PR #13247 R3) S20: same-tenant admission bursts (the #13365 deadlock shape) with W2 in the mix:
// N cwd changes on N Sessions + N later Turns on N other Sessions + N new Session creations, all released together.
import { api, Report, register, createSession, waitTurn, sleep, j, one, sql } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs } from './cwd.mjs';

const R = new Report(process.env.NAME ?? 's20-tenant-burst');
const N = Number(process.env.N ?? 8);
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const tag = Date.now() % 100000;
const WS = `ws-s20-${tag}`;
register(WS, 'st-e');
for (let i = 0; i < ROUNDS; i++) mkdirWs('e', `burst-${i}`);
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const mk = async () => { const c = await createSession('public', WS, 'PLAIN'); await waitTurn(c.session); return c.session; };
const cwdSessions = []; const turnSessions = [];
for (let i = 0; i < N; i++) { cwdSessions.push(await mk()); turnSessions.push(await mk()); }
const deadlocksBefore = Number(one(`SELECT COUNT FROM information_schema.INNODB_METRICS WHERE NAME='lock_deadlocks'`) ?? 0);
let allOk = true; const tally = {};
for (let round = 0; round < ROUNDS; round++) {
  const reqs = [
    ...cwdSessions.map((s) => () => pubChange(s, `burst-${round}`, binding(s).rev, { key: `s20c-${round}-${s}` })),
    ...turnSessions.map((s, i) => () => api('POST', `/v1/agents/sessions/${s}/events`, msg('PLAIN'), { key: `s20t-${round}-${i}-${tag}` })),
    ...Array.from({ length: N }, (_, i) => () => api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'PLAIN' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { key: `s20n-${round}-${i}-${tag}` })),
  ];
  const revs = cwdSessions.map((s) => binding(s).rev);
  const rs = await Promise.all(reqs.map((f) => f()));
  for (const r of rs) { const k = `${r.status} ${r.json.error?.code ?? ''}`.trim(); tally[k] = (tally[k] ?? 0) + 1; }
  const cwdOps = rs.slice(0, N);
  const settled = await Promise.all(cwdOps.map((r, i) => (r.status === 202 ? waitCwdOp(cwdSessions[i], opId(r)) : r)));
  for (const s of turnSessions) await waitTurn(s, { timeoutMs: 60_000 });
  await sleep(1500);
  const okRound = rs.every((r) => r.status === 202) && settled.every((w) => w.json.status === 'completed') && cwdSessions.every((s, i) => binding(s).rev === revs[i] + 1);
  if (!okRound) { allOk = false; R.note(`round ${round}`, j({ tally, statuses: rs.map((r) => r.status) })); }
}
const deadlocksAfter = Number(one(`SELECT COUNT FROM information_schema.INNODB_METRICS WHERE NAME='lock_deadlocks'`) ?? 0);
R.check(`${ROUNDS} rounds × (${N} cwd changes + ${N} later Turns + ${N} creations), same tenant, barrier-released: all 202, every change completes once`, allOk, j(tally));
R.check('no InnoDB deadlock during the bursts (information_schema lock_deadlocks)', deadlocksAfter === deadlocksBefore, `lock_deadlocks ${deadlocksBefore} → ${deadlocksAfter}`);
R.done({ tally });
