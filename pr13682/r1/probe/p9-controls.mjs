// VERIFICATION RIG ONLY (PR #13682): controls that separate the approval-delivery fix from the dispatcher restart.
//   slow-term   : a plain tool Turn (model waits HOLD ms, then write_file) across a TERM restart of A — no approval.
//   approve-kill: p1's approval, but A is SIGKILLed instead of TERMed before the answer.
//   approve-peer: no restart at all; carol answers through replica C (empty attachment cache, Broker A untouched).
// usage: DB=<db> RESTART_CMD/KILL_CMD='...' node p9-controls.mjs <mode> <workspace> <storage>
import { execSync } from 'node:child_process';
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, modelEntries, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [MODE, WS, ST] = process.argv.slice(2);
const r = new Report(`p9-${MODE}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const tag = Date.now() % 100000;
const harnessLog = () => { const f = execSync(`ls -t ${process.env.RUNDIR}/harness-*.log | head -1`, { encoding: 'utf8' }).trim(); return f; };
const blockedLines = (S) => execSync(`grep -c "recovery blocked" ${harnessLog()} || true`, { encoding: 'utf8' }).trim();
const SPRING_C = process.env.SPRING_C_URL;
const respondVia = (base, S, action, actor, key) => api('POST', `/v1/agents/sessions/${S}/actions/${action.id}/responses`, { kind: 'permission', option_id: 'allow', input_revision: action.input_revision, policy_revision: action.policy_revision }, { key, actor, base });
const first = MODE === 'slow-term' ? 'PLAIN first' : `G_WRITE name=a1-${tag}.txt content=first`;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: first }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = created.json.id;
if (MODE !== 'slow-term') { const p0 = await waitPending(S, { timeoutMs: 60_000 }); await respondVia(undefined, S, p0.action, 'alice', k('allow1')); }
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 60_000 })).status === 'COMPLETED', S);
const b0 = Number(blockedLines(S));
const mark = tapEntries().length;
const ex0 = executions(S);
let file, end, extra = {};
if (MODE === 'slow-term') {
  const HOLD = Number(process.env.HOLD ?? 25_000);
  const name = `slow-${tag}.txt`;
  await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_SLOW name=${name} hold=${HOLD} tag=s${tag}`), { actor: 'alice', key: k('slow') });
  for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === `s${tag}`); i++) await sleep(100);
  const out = execSync(process.env.RESTART_CMD, { encoding: 'utf8' }).trim().split('\n').at(-1);
  r.note('A restarted (TERM) while the model call is in flight', out);
  end = await waitTurn(S, { timeoutMs: HOLD + 60_000 });
  await sleep(1000);
  file = readWs(ST, `child/${name}`);
} else {
  await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=a2-${tag}.txt content=second`), { actor: 'alice', key: k('later') });
  const pend = (await waitPending(S, { timeoutMs: 60_000, not: [sql(`SELECT action_id FROM managed_agent_action WHERE session_id='${S}' ORDER BY created_at LIMIT 1`)[0][0]] })).action;
  if (MODE === 'approve-kill') {
    const out = execSync(process.env.KILL_CMD, { encoding: 'utf8' }).trim().split('\n').at(-1);
    r.note('A SIGKILLed and restarted', out);
    await sleep(4000);
  }
  const base = MODE === 'approve-peer' ? SPRING_C : undefined;
  const a = await respondVia(base, S, pend, 'carol', k('carol'));
  r.note(`answer via ${MODE === 'approve-peer' ? 'replica C' : 'replica A'}`, `${a.status} ${a.json?.operation_id ?? a.json?.error?.code ?? ''}`);
  const opq = () => sql(`SELECT state, COALESCE(error_code,''), attempt_count FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`)[0];
  let o = opq(); const t0 = Date.now();
  for (let i = 0; i < 300 && !['COMPLETED', 'FAILED'].includes(o?.[0]); i++) { await sleep(200); o = opq(); }
  extra.op = o; extra.opMs = Date.now() - t0;
  r.note('answer operation', `${j(o)} at +${extra.opMs} ms`);
  end = await waitTurn(S, { timeoutMs: 45_000 });
  await sleep(1000);
  file = readWs(ST, `child/a2-${tag}.txt`);
}
const calls = tapEntries().slice(mark).filter((e) => e.path?.startsWith(`/session/${S}`) && !e.path.endsWith('/heartbeat') && !e.path.endsWith('/events'))
  .map((e) => `${e.method} ${e.path.replace(S, ':id').replace(/actions\/[^/]+/, 'actions/:a')}${e.body?.passive !== undefined ? ` passive=${e.body.passive}` : ''} ${e.status ?? '-'}${e.upstreamBody?.error?.code ? ' ' + e.upstreamBody.error.code : ''}`)
  .reduce((acc, x) => { const l = acc.at(-1); if (l && l[0] === x) l[1]++; else acc.push([x, 1]); return acc; }, []).map(([x, n]) => (n > 1 ? `${x} ×${n}` : x));
const blocked = Number(blockedLines(S)) - b0;
r.note('Harness calls for the Session', j(calls));
r.note('Turn / file / executions added / new "recovery blocked" lines in the Harness log', `${end.status}${end.timeout ? ' (not terminal)' : ''} / ${file} / ${executions(S) - ex0} / ${blocked}`);
r.check('the Turn completes and the tool write lands once', end.status === 'COMPLETED' && file !== null && executions(S) - ex0 === 1, `${end.status} ${file}`);
if (end.timeout) {
  const turnId = turnRow(S).at(-1)[0];
  const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: turnId }, { actor: 'alice', key: k('cleanup') });
  const e2 = await waitTurn(S, { timeoutMs: 90_000 });
  r.note('cleanup cancel', `${c.status} → ${e2.status}`);
}
r.done({ session: S, mode: MODE, end: end.status, file, blocked, calls, ...extra });
process.exit(0);
