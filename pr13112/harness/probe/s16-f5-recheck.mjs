// VERIFICATION RIG ONLY (PR #13112 round 6): F5 re-check on Linux durable after 8953b8ff.
// usage: BASE=http://127.0.0.1:18137 RUNDIR=<rig>/run/lx-<db> DB=<db> node s16-f5-recheck.mjs [A,B,C,E]
//   A kill -> close (control)        B kill -> 1 later Turn -> close (F5)
//   C SIGSTOP (worker alive, frozen) -> later Turn -> close     E kill -> 3 later Turns -> close
import { spawnSync } from 'node:child_process';
import { api, sql, one, register, waitTurn, turnRow, Report, sleep, TENANT, j } from './lib.mjs';
const r = new Report(`s16-f5-recheck-${process.env.DB}`);
const RUNC = `/var/rig/run/${process.env.DB}`;
const lx = (cmd) => spawnSync('docker', ['--context', 'colima-pr13112', 'exec', 'pr13112-lx', 'bash', '-c', cmd], { encoding: 'utf8' }).stdout.trim();
const k = (s) => `${s}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const bindings = (S) => sql(`SELECT binding_state, runtime_generation, drain_requested, IF(drain_receipt_json IS NULL,'-','receipt') FROM qwen_runtime_binding WHERE isolation_key='${S}' ORDER BY runtime_generation`).map((x) => x.join('/')).join(' ');
const workerPid = (S) => {
  const e = sql(`SELECT DISTINCT b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`).flat()[0];
  const hex = Number(new URL(e).port).toString(16).toUpperCase().padStart(4, '0');
  return lx(`inode=$(awk '$2 ~ /:${hex}$/ && $4 == "0A" {print $10}' /proc/net/tcp /proc/net/tcp6 | head -1); [ -n "$inode" ] && for p in /proc/[0-9]*; do ls -l $p/fd 2>/dev/null | grep -q "socket:\\[$inode\\]" && basename $p && break; done`);
};
const procState = (pid) => lx(`[ -r /proc/${pid}/status ] && awk '/^State/ {print $2$3}' /proc/${pid}/status || echo gone`);
async function closeAndWait(S, ms = 150_000) {
  const t0 = Date.now();
  const c = await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close'), timeoutMs: 60_000 });
  if (c.status !== 202) return { admit: c.status, code: c.json.error?.code, ms: Date.now() - t0 };
  for (;;) {
    const g = await api('GET', `/v1/agents/sessions/${S}/operations/${c.json.id}`, undefined, { actor: 'alice' });
    const st = g.json.status;
    if (['completed', 'failed'].includes(st) || (st === 'recovery_blocked' && Date.now() - t0 > 20_000) || Date.now() - t0 > ms) return { status: st, failure: g.json.failure_code ?? g.json.error?.code, ms: Date.now() - t0 };
    await sleep(400);
  }
}
async function arm(id, label, ws, st, setup) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`) === '0') register(ws, `st-${st}`);
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=${id}.txt tag=${id}0` }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: k(id) });
  const S = c.json.id;
  r.note(`${label}: first Turn`, j(await waitTurn(S, { timeoutMs: 120_000 })));
  const pid = workerPid(S);
  await setup(S, pid);
  const cl = await closeAndWait(S);
  r.note(`${label}: close`, `${j(cl)} session=${one(`SELECT status FROM managed_agent_session WHERE session_id='${S}'`)}`);
  r.note(`${label}: after close`, `bindings=${bindings(S)} worker ${pid}=${procState(pid)} file=${lx(`cat ${RUNC}/ws/${st}/child/${id}.txt 2>/dev/null || echo MISSING`).slice(0, 40)} turns=${turnRow(S).map((x) => x[1]).join(',')}`);
  const n = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=${id}-n.txt tag=${id}n` }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: k(`${id}-n`) });
  const nt = await waitTurn(n.json.id, { timeoutMs: 120_000 });
  r.note(`${label}: new Session on the same storage`, `${n.status} ${j(nt)} file=${lx(`cat ${RUNC}/ws/${st}/child/${id}-n.txt 2>/dev/null || echo MISSING`).slice(0, 40)}`);
  return { S, cl, nt, pid };
}
const later = async (S, id, n, ms = 120_000) => {
  const t0 = Date.now();
  const t = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_FILES name=${id}.txt tag=${id}-l${n}`), { actor: 'alice', key: k(`${id}-l${n}`) });
  const w = await waitTurn(S, { timeoutMs: ms });
  return `${t.status} ${j(w)} in ${Date.now() - t0} ms; bindings=${bindings(S)}`;
};
const want = (process.argv[2] ?? 'A,B,C,E').split(',');
const out = {};
if (want.includes('A')) out.A = await arm('a6', 'A kill -> close', 'ws-d', 'd', async (S, pid) => { lx(`kill -9 ${pid}`); await sleep(2000); r.note('A: killed', `${pid} bindings=${bindings(S)}`); });
if (want.includes('B')) out.B = await arm('b6', 'B kill -> later Turn -> close', 'ws-e', 'e', async (S, pid) => {
  lx(`kill -9 ${pid}`); await sleep(2000);
  r.note('B: later Turn after the kill', await later(S, 'b6', 1));
});
if (want.includes('C')) out.C = await arm('c6', 'C SIGSTOP -> later Turn -> close', 'ws-f', 'f', async (S, pid) => {
  lx(`kill -STOP ${pid}`); await sleep(1000);
  r.note('C: worker frozen', `${pid} ${procState(pid)}`);
  r.note('C: later Turn against the frozen worker', await later(S, 'c6', 1, 240_000));
  r.note('C: worker before close', procState(pid));
});
if (want.includes('E')) out.E = await arm('e6', 'E kill -> 3 later Turns -> close', 'ws-g', 'g', async (S, pid) => {
  lx(`kill -9 ${pid}`); await sleep(2000);
  for (let n = 1; n <= 3; n++) r.note(`E: later Turn ${n}`, await later(S, 'e6', n));
});
for (const [id, v] of Object.entries(out)) {
  r.check(`${id}: close completed`, v.cl.status === 'completed', j(v.cl));
  r.check(`${id}: new Session on the same storage completed`, v.nt.status === 'COMPLETED', j(v.nt));
  r.check(`${id}: original worker not running`, ['gone', 'Z(zombie)'].includes(procState(v.pid)), `${v.pid} ${procState(v.pid)}`);
}
r.note('operations not completed', j(sql(`SELECT session_id, state, COALESCE(error_code,'') FROM managed_agent_operation WHERE state NOT IN ('COMPLETED')`)));
r.done(Object.fromEntries(Object.entries(out).map(([key, v]) => [key, v.S])));
