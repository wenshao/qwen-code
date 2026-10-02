// VERIFICATION RIG ONLY (PR #13112 r5): A/B on Linux durable. Worker killed, then close; with vs without a later Turn first.
import { spawnSync } from 'node:child_process';
import { api, sql, one, register, waitTurn, Report, sleep, TENANT, j } from './lib.mjs';
const r = new Report(`s15c-close-ab-${process.env.DB}`);
const lx = (cmd) => spawnSync('docker', ['--context', 'colima-pr13112', 'exec', 'pr13112-lx', 'bash', '-c', cmd], { encoding: 'utf8' }).stdout.trim();
const k = (s) => `${s}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const binding = (S) => j(sql(`SELECT DISTINCT b.binding_state FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`).flat());
const workerPid = (S) => {
  const e = sql(`SELECT DISTINCT b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`).flat()[0];
  const hex = Number(new URL(e).port).toString(16).toUpperCase().padStart(4, '0');
  return lx(`inode=$(awk '$2 ~ /:${hex}$/ && $4 == "0A" {print $10}' /proc/net/tcp /proc/net/tcp6 | head -1); [ -n "$inode" ] && for p in /proc/[0-9]*; do ls -l $p/fd 2>/dev/null | grep -q "socket:\\[$inode\\]" && basename $p && break; done`);
};
async function closeAndWait(S, ms = 120_000) {
  const c = await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close') });
  if (c.status !== 202) return { admit: c.status, code: c.json.error?.code };
  const start = Date.now();
  for (;;) {
    const g = await api('GET', `/v1/agents/sessions/${S}/operations/${c.json.id}`, undefined, { actor: 'alice' });
    if (['completed', 'failed', 'recovery_blocked'].includes(g.json.status) && Date.now() - start > 5000 || ['completed', 'failed'].includes(g.json.status) || Date.now() - start > ms) return { status: g.json.status, failure: g.json.failure_code, ms: Date.now() - start };
    await sleep(500);
  }
}
async function arm(label, ws, st, laterTurnFirst) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`) === '0') register(ws, `st-${st}`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=${label}.txt tag=${label}` }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: k(label) });
  const S = c.json.id;
  await waitTurn(S, { timeoutMs: 120_000 });
  const pid = workerPid(S);
  lx(`kill -9 ${pid}`);
  await sleep(2000);
  r.note(`${label}: worker ${pid} killed; binding`, binding(S));
  if (laterTurnFirst) {
    const t = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_FILES name=${label}.txt tag=${label}-later`), { actor: 'alice', key: k('later') });
    r.note(`${label}: later Turn after the kill`, `${t.status} ${j(await waitTurn(S, { timeoutMs: 90_000 }))} binding=${binding(S)}`);
  }
  const cl = await closeAndWait(S);
  r.note(`${label}: close`, `${j(cl)} session=${one(`SELECT status FROM managed_agent_session WHERE session_id='${S}'`)} binding=${binding(S)}`);
  const n = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=${label}-n.txt tag=${label}-n` }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: k(`${label}-n`) });
  r.note(`${label}: new Session on the same storage afterwards`, `${n.status} ${j(await waitTurn(n.json.id, { timeoutMs: 120_000 }))}`);
}
await arm('A-close-direct', 'ws-d', 'd', false);
await arm('B-later-turn-then-close', 'ws-e', 'e', true);
r.done();
