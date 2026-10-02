// VERIFICATION RIG ONLY: after a close went recovery_blocked on st-c, does a new Session on the same storage still run?
import { api, waitTurn, Report, j } from './lib.mjs';
const r = new Report('s15b-storage-after-blocked-close');
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=l3new.txt tag=n0' }], workspace: { workspace_id: 'ws-c', cwd_relative: 'child' } }, { actor: 'alice', key: `n-${Date.now()}` });
r.note('new Session on the same storage (st-c)', `${c.status} ${j(await waitTurn(c.json.id, { timeoutMs: 120_000 }))}`);
const d = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=other.txt tag=o0' }], workspace: { workspace_id: 'ws-a', cwd_relative: 'child' } }, { actor: 'alice', key: `o-${Date.now()}` });
r.note('new Session on another storage (st-a)', `${d.status} ${j(await waitTurn(d.json.id, { timeoutMs: 120_000 }))}`);
r.done();
