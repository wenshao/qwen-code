// VERIFICATION RIG ONLY (PR #13247) S4: admission races over real HTTP; exactly one winner, one commit, one event.
import { Report, ensureWorkspace, createSession, waitTurn, sleep, j, one, WS, ST } from './lib.mjs';
import { pubChange, webChange, opId, waitCwdOp, binding, ctxEvents, mkdirWs, openOps } from './cwd.mjs';

const R = new Report('s4-races');
ensureWorkspace(WS, `st-${ST}`);
for (let i = 0; i < 4; i++) mkdirWs(ST, `race${i}`);
const ROUNDS = Number(process.env.ROUNDS ?? 10);
const N = Number(process.env.N ?? 20);
const c = await createSession('public', WS, 'PLAIN');
const s = c.session;
await waitTurn(s);
const tally = (rs) => rs.reduce((m, r) => ((m[`${r.status} ${r.json?.error?.code ?? r.json?.status ?? ''}`.trim()] = (m[`${r.status} ${r.json?.error?.code ?? r.json?.status ?? ''}`.trim()] ?? 0) + 1), m), {});

let okRounds = 0;
const seen = {};
for (let round = 0; round < ROUNDS; round++) {
  const rev = binding(s).rev;
  const ev0 = ctxEvents(s).length;
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => (i % 2 ? webChange : pubChange)(s, `race${(round + i) % 4}`, rev, { key: `s4-${round}-${i}-${Date.now()}` })));
  const winners = rs.filter((r) => r.status === 202);
  for (const [k, v] of Object.entries(tally(rs))) seen[k] = (seen[k] ?? 0) + v;
  let done = null;
  if (winners.length === 1) done = await waitCwdOp(s, opId(winners[0]));
  await sleep(200);
  const b = binding(s);
  const ev = ctxEvents(s).length;
  const ok = winners.length === 1 && done.json.status === 'completed' && b.rev === rev + 1 && ev === ev0 + 1 && openOps(s) === 0 && rs.every((r) => r.status === 202 || (r.status === 409 && ['session_context_busy', 'context_revision_conflict'].includes(r.json.error?.code)));
  if (ok) okRounds++;
  else R.note(`round ${round} detail`, j({ winners: winners.length, tally: tally(rs), rev: [rev, b.rev], ev: [ev0, ev] }));
}
R.check(`${ROUNDS} rounds × ${N} concurrent distinct-key admissions (public/WebShell interleaved): exactly one 202, one commit, one event per round`, okRounds === ROUNDS, `${okRounds}/${ROUNDS} outcome tally ${j(seen)}`);

// same key, same payload, concurrently (public + WebShell share the actor-scoped key space?)
const rev = binding(s).rev;
const key = `s4-same-${Date.now()}`;
const same = await Promise.all(Array.from({ length: N }, (_, i) => (i % 2 ? webChange : pubChange)(s, i % 3 ? 'race1/' : './race1', rev, { key })));
const ids = new Set(same.filter((r) => r.status === 202).map(opId));
const rows = Number(one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${s}' AND idempotency_key='${key}'`));
R.check(`${N} concurrent same-key same-payload (mixed surfaces, mixed spellings) → all 202, one operation id, one row`, same.every((r) => r.status === 202) && ids.size === 1 && rows === 1, `${j(tally(same))} ids=${ids.size} rows=${rows} replayed=${same.filter((r) => r.json.replayed).length}`);
await waitCwdOp(s, [...ids][0]);

// same key, different payloads concurrently
const rev2 = binding(s).rev;
const key2 = `s4-diff-${Date.now()}`;
const diff = await Promise.all(Array.from({ length: N }, (_, i) => pubChange(s, `race${i % 4}`, rev2, { key: key2 })));
const rows2 = Number(one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${s}' AND idempotency_key='${key2}'`));
const winTarget = diff.find((r) => r.status === 202 && !r.json.replayed)?.json.target_cwd_relative;
R.check(`${N} concurrent same-key different-payload → one row; same-payload callers replay, others 409 idempotency_conflict`, rows2 === 1 && diff.every((r) => (r.status === 202 && r.json.target_cwd_relative === winTarget) || (r.status === 409 && r.json.error?.code === 'idempotency_conflict')), `${j(tally(diff))} rows=${rows2} winner=${winTarget}`);
R.done({ session: s, seen });
