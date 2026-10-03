// VERIFICATION RIG ONLY (PR #13112 r6): after a Spring restart, new Sessions on the storages used by the F5 arms.
import { api, waitTurn, sql, Report, j } from './lib.mjs';
const r = new Report(`s16b-after-restart-${process.env.DB}`);
for (const ws of ['ws-e', 'ws-f', 'ws-g', 'ws-d']) {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=rs.txt tag=rs-${ws}` }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: `rs-${ws}-${Date.now()}` });
  const t = await waitTurn(c.json.id, { timeoutMs: 120_000 });
  r.check(`after restart: new Session on ${ws}`, t.status === 'COMPLETED', `${c.status} ${j(t)}`);
}
r.note('bindings not RELEASED/READY', j(sql(`SELECT binding_state, COUNT(*) FROM qwen_runtime_binding WHERE binding_state NOT IN ('RELEASED','READY') GROUP BY binding_state`)));
r.done();
