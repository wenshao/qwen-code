// VERIFICATION RIG ONLY (PR #13163, round 5): does a Turn wedged by #13054 (recovery blocked, CANCELLING) keep its
// storage's execution lease, so that another Workspace on the same storage cannot run? A different storage is the
// control. Run after c10-blocked.mjs <wsA> <st> revoked.
// usage: DB=<db> node c20-storage-pin.mjs <same-storage> <other-storage>
import { api, one, register, waitTurn, sql, Report, TENANT, j } from './lib.mjs';
const [SAME, OTHER] = process.argv.slice(2);
const r = new Report(`c20-storage-pin-${SAME}`);
const k = (s) => `${s}-${Date.now()}`;
const out = {};
for (const [label, st] of [['same storage as the wedged Turn', SAME], ['other storage', OTHER]]) {
  const ws = `ws-pin-${st}-${Date.now() % 100000}`;
  register(ws, `st-${st}`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=p.txt tag=p0' }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: k(ws) });
  const w = await waitTurn(c.json.id, { timeoutMs: 120_000 });
  r.note(`${label} (st-${st}): first Turn of a new Session`, `${w.status} ${w.error ?? ''} in ${w.ms} ms`);
  out[label] = [w.status, w.error];
}
r.note('execution leases held', j(sql(`SELECT storage_key, runtime_session_id FROM managed_workspace_execution_lease WHERE holder_key IS NOT NULL`)));
r.done(out);
process.exit(0);
