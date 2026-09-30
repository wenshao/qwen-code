// VERIFICATION RIG ONLY (PR #13112): a real model holds a three-Turn conversation in a bound Session.
// usage: DB=<db> node s9-real-model.mjs <workspace> <storage>
import { api, one, register, waitTurn, executions, readWs, Report, TENANT, j } from './lib.mjs';

const [WS, ST] = [process.argv[2] ?? 'ws-h', process.argv[3] ?? 'h'];
const r = new Report(`s9-real-model-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${Date.now()}`;
async function lastReply(S) {
  const items = await api('GET', `/v1/agents/sessions/${S}/items?limit=100`, undefined, { actor: 'alice' });
  const msgs = (items.json.data ?? []).filter((i) => i.type === 'message' && i.role === 'assistant');
  const m = msgs.at(-1);
  return (m?.content ?? []).map((c) => c.text ?? '').join('').trim();
}
const t1 = 'Create a file named notes.txt in the current directory containing exactly one line: alpha-7319. Use the write_file tool. Reply with one short sentence.';
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: t1 }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = c.json.id;
const w1 = await waitTurn(S, { timeoutMs: 240_000 });
r.check('Turn 1 (create notes.txt) COMPLETED', w1.status === 'COMPLETED', `${j(w1)}`);
r.note('notes.txt after Turn 1', JSON.stringify(readWs(ST, 'child/notes.txt')));
const t2 = 'Now add a second line beta-2604 to notes.txt, keeping the first line. Reply with one short sentence.';
const x2 = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: t2 }] }, { actor: 'alice', key: k('t2') });
const w2 = await waitTurn(S, { timeoutMs: 240_000 });
const f2 = readWs(ST, 'child/notes.txt');
r.check('Turn 2 (later Turn, edit the same file) 202 + COMPLETED', x2.status === 202 && w2.status === 'COMPLETED', `${x2.status} ${j(w2)}`);
r.check('notes.txt now holds alpha-7319 then beta-2604', /alpha-7319\s*\n\s*beta-2604/.test(f2 ?? ''), JSON.stringify(f2));
const t3 = 'Without using any tool: what exact text did I ask you to put on the first line in my first message? Answer with just that text.';
const x3 = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: t3 }] }, { actor: 'alice', key: k('t3') });
const w3 = await waitTurn(S, { timeoutMs: 240_000 });
const reply = await lastReply(S);
r.check('Turn 3 answers from the conversation history', x3.status === 202 && w3.status === 'COMPLETED' && /alpha-7319/.test(reply), `${x3.status} ${w3.status} reply=${JSON.stringify(reply.slice(0, 200))}`);
r.note('tool executions for the Session', `${executions(S)}`);
const reader = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'delete notes.txt' }] }, { actor: 'carol', key: k('carol') });
r.check('another creator-capable actor is refused', reader.status === 409, `${reader.status} ${reader.json.error?.code}`);
r.done({ session: S });
process.exit(r.fail ? 1 : 0);
