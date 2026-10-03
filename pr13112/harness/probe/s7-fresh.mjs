// VERIFICATION RIG ONLY (PR #13112 r6): a fresh bound Session for the panel run (created after the last Spring restart).
import { api, waitTurn, j } from './lib.mjs';
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=uiseed.txt tag=seed' }], workspace: { workspace_id: 'ws-h', cwd_relative: 'child' } }, { actor: 'alice', key: `ui-fresh-${Date.now()}` });
const t = await waitTurn(c.json.id, { timeoutMs: 120_000 });
console.log(c.json.id, j(t));
