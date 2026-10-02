import { api, waitTurn, sql, Report, j } from './lib.mjs';
const r = new Report('s15d-persist');
for (const ws of ['ws-c', 'ws-e', 'ws-d']) {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=p.txt tag=p-${ws}` }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: `p-${ws}-${Date.now()}` });
  r.note(`new Session on ${ws} (${new Date().toISOString().slice(11, 19)})`, `${c.status} ${j(await waitTurn(c.json.id, { timeoutMs: 120_000 }))}`);
}
r.note('blocked close operations', j(sql(`SELECT o.session_id, o.state, COALESCE(o.error_code,'') FROM managed_agent_operation o WHERE o.state='RECOVERY_BLOCKED'`)));
r.done();
