// VERIFICATION RIG ONLY (PR #13112 round 5): later Turns x main's durable bound-Session close (#13135) on Linux.
// usage: BASE=http://127.0.0.1:18137 RUNDIR=<rig>/run/lx-<db> DB=<db> node s15-close-linux.mjs
import { spawnSync } from 'node:child_process';
import { api, sql, one, register, waitTurn, turnRow, executions, modelEntries, Report, sleep, TENANT, j } from './lib.mjs';

const r = new Report(`s15-close-linux-${process.env.DB}`);
const lx = (cmd) => spawnSync('docker', ['--context', 'colima-pr13112', 'exec', 'pr13112-lx', 'bash', '-c', cmd], { encoding: 'utf8' }).stdout.trim();
const RUNC = `/var/rig/run/${process.env.DB}`;
const k = (s) => `${s}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
for (const [w, st] of [['ws-a', 'a'], ['ws-b', 'b'], ['ws-c', 'c']]) if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${w}'`) === '0') register(w, `st-${st}`);
const create = async (ws, text) => {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
  return { S: c.json.id, t: await waitTurn(c.json.id, { timeoutMs: 120_000 }) };
};
async function closeAndWait(S) {
  const c = await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: k('close') });
  if (c.status !== 202) return { admit: c.status, code: c.json.error?.code };
  const start = Date.now();
  for (;;) {
    const g = await api('GET', `/v1/agents/sessions/${S}/operations/${c.json.id}`, undefined, { actor: 'alice' });
    if (['completed', 'failed'].includes(g.json.status) || Date.now() - start > 90_000) return { admit: 202, status: g.json.status, error: g.json.error?.code, ms: Date.now() - start };
    await sleep(300);
  }
}
const endpoint = (S) => sql(`SELECT DISTINCT b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`).flat()[0];
const binding = (S) => j(sql(`SELECT DISTINCT b.binding_state FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`).flat());
const workerPid = (S) => { const e = endpoint(S); if (!e) return ''; const port = new URL(e).port; const hex = Number(port).toString(16).toUpperCase().padStart(4, '0'); return lx(`inode=$(awk '$2 ~ /:${hex}$/ && $4 == "0A" {print $10}' /proc/net/tcp /proc/net/tcp6 | head -1); [ -n "$inode" ] && for p in /proc/[0-9]*; do ls -l $p/fd 2>/dev/null | grep -q "socket:\\[$inode\\]" && basename $p && break; done`); };
const caps = async (S, actor = 'alice') => (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor })).json.capabilities;

// L1 later Turn, then close an idle bound Session
const { S: A, t: a0 } = await create('ws-a', 'G_FILES name=l1.txt tag=l0');
r.check('L1 initial Turn COMPLETED (durable Linux)', a0.status === 'COMPLETED', j(a0));
const c0 = await caps(A);
r.check('L1 creator capabilities: workspaceTurns and sessionClose both true', c0?.workspaceTurns === true && c0?.sessionClose === true, j(c0));
const l1 = await api('POST', `/v1/agents/sessions/${A}/events`, msg('G_FILES name=l1.txt tag=l1'), { actor: 'alice', key: k('l1') });
const t1 = await waitTurn(A, { timeoutMs: 120_000 });
r.check('L1 later Turn COMPLETED', l1.status === 202 && t1.status === 'COMPLETED', j(t1));
const pidA = workerPid(A);
const cA = await closeAndWait(A);
r.check('L1 creator closes the idle Session -> completed', cA.admit === 202 && cA.status === 'completed', j(cA));
r.note('L1 after close', `session=${one(`SELECT status FROM managed_agent_session WHERE session_id='${A}'`)} binding=${binding(A)} worker pid ${pidA} alive=${lx(`kill -0 ${pidA} 2>/dev/null && echo yes || echo no`)} file=${lx(`cat ${RUNC}/ws/a/child/l1.txt`)} turns=${turnRow(A).length}`);
const after = await api('POST', `/v1/agents/sessions/${A}/events`, msg('PLAIN'), { actor: 'alice', key: k('after') });
const ca = await caps(A);
r.check('L1 later Turn on a closed Session is refused; workspaceTurns=false', after.status === 409 && ca?.workspaceTurns === false, `${after.status} ${after.json.error?.code} caps=${j(ca)}`);

// L2 close while the creator's later Turn runs, then cancel and close
const { S: B } = await create('ws-b', 'G_FILES name=l2.txt tag=b0');
const hold = await api('POST', `/v1/agents/sessions/${B}/events`, msg('G_HOLD tag=lx-hold'), { actor: 'alice', key: k('hold') });
for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'HOLD' && e.tag === 'lx-hold'); i++) await sleep(100);
const cB1 = await closeAndWait(B);
r.check('L2 close while a later Turn runs -> 409 turn_active', cB1.admit === 409 && cB1.code === 'turn_active', j(cB1));
const cancel = await api('POST', `/v1/agents/sessions/${B}/events`, { type: 'agent.session.cancel', turn_id: hold.json.turn_id }, { actor: 'alice', key: k('cancel') });
const tb = await waitTurn(B, { timeoutMs: 40_000 });
r.check('L2 creator cancels the running later Turn -> CANCELLED', cancel.status === 202 && tb.status === 'CANCELLED', `${cancel.status} ${j(tb)}`);
const pidB = workerPid(B);
const cB2 = await closeAndWait(B);
r.check('L2 then close -> completed, worker stopped', cB2.status === 'completed' && lx(`kill -0 ${pidB} 2>/dev/null && echo yes || echo no`) === 'no', `${j(cB2)} pid=${pidB}`);

// L3 F2: the worker dies; later Turns fail; can the creator close the Session?
const { S: C } = await create('ws-c', 'G_FILES name=l3.txt tag=c0');
const pidC = workerPid(C);
lx(`kill -9 ${pidC}`);
await sleep(1500);
const lc = await api('POST', `/v1/agents/sessions/${C}/events`, msg('G_FILES name=l3.txt tag=c1'), { actor: 'alice', key: k('c1') });
const tc = await waitTurn(C, { timeoutMs: 90_000 });
r.note('L3 later Turn after the durable worker was killed', `${lc.status} ${j(tc)} binding=${binding(C)} worker pid ${pidC}`);
const cC = await closeAndWait(C);
r.check('L3 creator can close the Session whose worker died', cC.status === 'completed', `${j(cC)} session=${one(`SELECT status FROM managed_agent_session WHERE session_id='${C}'`)} binding=${binding(C)}`);
r.done({ A, B, C });
