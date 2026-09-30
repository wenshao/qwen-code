// VERIFICATION RIG ONLY (PR #13112): keep talking to a bound Session across restarts; an unbound Session is the control.
// usage: DB=<db> node s5-restarts.mjs <phase: setup|after-spring|after-harness> <workspace> <storage>
import fs from 'node:fs';
import { api, one, register, waitTurn, turnRow, executions, readWs, modelEntries, Report, RUN, TENANT, j } from './lib.mjs';

const [PHASE, WS, ST] = [process.argv[2], process.argv[3] ?? 'ws-d', process.argv[4] ?? 'd'];
const r = new Report(`s5-${PHASE}-${WS}`);
const state = `${RUN}/s5-${WS}.json`;
const k = (s) => `${s}-${WS}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });

async function turn(session, text, label) {
  const start = Date.now();
  const x = await api('POST', `/v1/agents/sessions/${session}/events`, msg(text), { actor: 'alice', key: k(label) });
  const t = x.status === 202 ? await waitTurn(session, { timeoutMs: 120_000 }) : null;
  return { admit: x.status, code: x.json.error?.code, turn: t?.status, error: t?.error, ms: Date.now() - start, timeout: t?.timeout };
}

if (PHASE === 'setup') {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
  const b = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=restart.txt tag=r0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('bound') });
  const u = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'PLAIN unbound first' }] }, { actor: 'alice', key: k('unbound') });
  const tb = await waitTurn(b.json.id, { timeoutMs: 90_000 });
  const tu = await waitTurn(u.json.id, { timeoutMs: 90_000 });
  r.check('bound Session initial Turn COMPLETED', tb.status === 'COMPLETED', j(tb));
  r.check('unbound control Session initial Turn COMPLETED', tu.status === 'COMPLETED', j(tu));
  const lb = await turn(b.json.id, 'G_FILES name=restart.txt tag=r0b', 'r0b');
  r.check('bound later Turn before any restart COMPLETED', lb.turn === 'COMPLETED', j(lb));
  fs.writeFileSync(state, JSON.stringify({ bound: b.json.id, unbound: u.json.id }));
} else {
  const { bound, unbound } = JSON.parse(fs.readFileSync(state, 'utf8'));
  const tag = PHASE === 'after-spring' ? 'r1' : 'r2';
  const before = executions(bound);
  const lb = await turn(bound, `G_FILES name=restart.txt tag=${tag}`, `bound-${tag}`);
  r.note(`bound Session later Turn ${PHASE}`, j(lb));
  r.check(`bound Session later Turn ${PHASE} COMPLETED`, lb.turn === 'COMPLETED', j(lb));
  if (lb.turn === 'COMPLETED') {
    r.check('file rewritten and 3 more executions', readWs(ST, 'child/restart.txt') === `after-${tag}` && executions(bound) === before + 3, `${readWs(ST, 'child/restart.txt')} ${executions(bound)}`);
    const req = modelEntries().filter((e) => e.tag === tag);
    r.note('model saw earlier user turns (history)', `userTurns=${req[0]?.userTurns} msgs=${req[0]?.msgs}`);
  }
  const lu = await turn(unbound, `PLAIN unbound ${tag}`, `unbound-${tag}`);
  r.note(`unbound control later Turn ${PHASE}`, j(lu));
  r.check(`unbound control later Turn ${PHASE} COMPLETED`, lu.turn === 'COMPLETED', j(lu));
  r.note('bound Turn history', j(turnRow(bound)));
  r.note('unbound Turn history', j(turnRow(unbound)));
}
r.done();
process.exit(r.fail ? 1 : 0);
