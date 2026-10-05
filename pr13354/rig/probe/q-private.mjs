import * as L from './lib.mjs';
const c = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'PLAIN private' }] }, { key: L.uid('priv') });
const s = c.json.id;
const t = await L.waitTurns(s, 1, 40_000);
console.log('private session', c.status, s, L.j(t.rows.at(-1)), t.ms, 'ms', t.timeout ? 'TIMEOUT' : '', L.j(await L.sessRow(s)));
await L.closeDb();
