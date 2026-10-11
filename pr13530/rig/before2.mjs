// main vs head: an unbound Session from a stored definition with model + instructions, one Turn.
import { client, modelLog, sleep } from './lib.mjs';
const [, , db, arm] = process.argv;
const c = client(db);
const run = Date.now().toString(36).slice(-5);
const a = await c.createAgent({ model: { id: 'model-b' }, instructions: `INSTR-UNBOUND-${run.toUpperCase()}`, tools: [], permission_policy: { approval_mode: 'default' } });
const id = `ub${arm}${run}`;
const s = await c.createSession({ agentId: a.json.id, bound: false, prompt: `D8::text::${id} hi` });
const w = s.status === 202 ? await c.waitTurn(s.json.id, { timeout: 90 }) : '-';
await sleep(300);
const r = modelLog((x) => x.id === id);
console.log(JSON.stringify({ arm, create: s.status, err: s.json?.error?.code, agent_revision: s.json?.agent_revision, agent_digest: s.json?.agent_digest ?? null, turn: w, requests: r.map((x) => ({ model: x.model, key: x.key, agentSection: x.agentIdx >= 0, instr: x.instr })) }));
