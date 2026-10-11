// usage: node lone.mjs <db> — create a plain Session whose first user prompt carries a lone surrogate
import { readFileSync } from 'node:fs'; import { randomUUID } from 'node:crypto';
const db = process.argv[2]; const st = JSON.parse(readFileSync(`/Users/wenshao/git/pr13858-rig/runs/${db}/state.json`, 'utf8'));
const text = 'PARENT::plain::lone' + db + '::x surrogate \ud800 here';
const res = await fetch(`http://127.0.0.1:${st.springPort}/v1/agents/sessions`, { method: 'POST', headers: { 'x-qwen-tenant-id': 'rig', 'x-rig-actor': 'rig-actor', 'content-type': 'application/json', 'idempotency-key': randomUUID() },
  body: JSON.stringify({ agent_id: 'qwen-code', workspace: { workspace_id: 'rig-ws' }, input: [{ type: 'input_text', text }] }) });
console.log(res.status, (await res.text()).slice(0, 200));
