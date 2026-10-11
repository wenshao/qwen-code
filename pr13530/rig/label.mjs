import { client } from './lib.mjs';
const [, , db, arm] = process.argv;
const c = client(db);
for (const agentId of ['custom-label', `agent_${'f'.repeat(32)}`]) {
  const r = await c.createSession({ agentId, bound: false });
  console.log(JSON.stringify({ arm, agentId, status: r.status, code: r.json?.error?.code, agent_revision: r.json?.agent_revision }));
}
