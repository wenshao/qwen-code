// VERIFICATION RIG ONLY (PR #13112): after the host-restart simulation, new vs existing bound Sessions.
import { api, waitTurn, Report, j } from './lib.mjs';
const r = new Report('s5b-after-reboot');
const k = (s) => `${s}-${Date.now()}`;
const n = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=fresh.txt tag=fresh' }], workspace: { workspace_id: 'ws-d', cwd_relative: 'child' } }, { actor: 'alice', key: k('fresh') });
const tn = await waitTurn(n.json.id, { timeoutMs: 120_000 });
r.note('NEW bound Session on ws-d (initial Turn)', `${n.status} ${j(tn)}`);
const old = process.argv[2];
const x = await api('POST', `/v1/agents/sessions/${old}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=proof.txt tag=reboot' }] }, { actor: 'alice', key: k('old') });
const tx = await waitTurn(old, { timeoutMs: 120_000 });
r.note('EXISTING bound Session on ws-a (later Turn)', `${x.status} ${j(tx)}`);
r.done();
