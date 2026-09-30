// VERIFICATION RIG ONLY (PR #13112): after the host-restart simulation: a new Session on ws-a, then the old ones again.
import { api, waitTurn, Report, j } from './lib.mjs';
const r = new Report('s5c-after-reboot');
const k = (s) => `${s}-${Date.now()}`;
const n = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=fresh-a.txt tag=fresh-a' }], workspace: { workspace_id: 'ws-a', cwd_relative: 'child' } }, { actor: 'alice', key: k('fresh') });
r.note('NEW bound Session on ws-a (initial Turn)', `${n.status} ${j(await waitTurn(n.json.id, { timeoutMs: 120_000 }))}`);
const later = async (s, label) => {
  const x = await api('POST', `/v1/agents/sessions/${s}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_FILES name=again.txt tag=${label}` }] }, { actor: 'alice', key: k(label) });
  return `${x.status} ${j(await waitTurn(s, { timeoutMs: 120_000 }))}`;
};
r.note('NEW ws-a Session later Turn', await later(n.json.id, 'fresh-a-later'));
for (const [s, label] of process.argv.slice(2).map((a) => a.split('='))) r.note(`EXISTING ${label} later Turn`, await later(s, label));
r.done();
