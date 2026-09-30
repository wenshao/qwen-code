import { api, waitTurn, Report, sleep, j } from './lib.mjs';
const r = new Report('s5d-retry-' + process.argv[3]);
for (const n of [1, 2]) {
  const x = await api('POST', `/v1/agents/sessions/${process.argv[2]}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_FILES name=restart.txt tag=${process.argv[3]}-${n}` }] }, { actor: 'alice', key: `retry-${Date.now()}` });
  r.note(`later Turn #${n}`, `${x.status} ${j(await waitTurn(process.argv[2], { timeoutMs: 120_000 }))}`);
}
r.done();
