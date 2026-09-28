import { api, register, waitTurn, g0Rest } from './lib.mjs';
const ws = process.argv[2], st = process.argv[3];
try { register(ws, st); } catch {}
const c = await api('POST', '/v1/agents/sessions', g0Rest(ws, `G0_FILES name=${ws}.txt`), { key: `sanity-${ws}` });
const w = await waitTurn(c.json.id, { timeoutMs: 90000 });
console.log(ws, c.status, c.json.id, JSON.stringify(w.rows[0]), w.ms);
