// VERIFICATION RIG ONLY (PR #13682): a Workspace approval answered after the dispatcher replica lost its attachment
// cache (restart), default verified-workspace-recovery-enabled=false. A READER is refused; a second OPERATOR (carol)
// answers the owner's (alice's) approval; the same responder's replay returns the same operation. The original
// operation must complete, the Action be decided, and the approved file land exactly once.
// usage: DB=<db> RESTART_CMD='...' node p1-approval-cold.mjs <workspace> <storage>
import { execSync } from 'node:child_process';
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, respond, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST] = process.argv.slice(2);
const r = new Report(`p1-approval-cold-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const tag = Date.now() % 100000;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_WRITE name=a1-${tag}.txt content=first` }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = created.json.id;
let p = await waitPending(S, { timeoutMs: 60_000 });
const first = p.action.id;
await respond('public', S, p.action, 'allow', { key: k('allow1') });
r.check('initial Turn COMPLETED after approval', (await waitTurn(S, { timeoutMs: 60_000 })).status === 'COMPLETED');
const l2 = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=a2-${tag}.txt content=second`), { actor: 'alice', key: k('later2') });
p = await waitPending(S, { timeoutMs: 60_000, not: [first] });
r.check('later Turn waits for approval', !p.timeout, p.timeout ? 'timeout' : p.action.id);
const A = p.action.id;
const mark = tapEntries().length;
const tr = Date.now();
const out = execSync(process.env.RESTART_CMD, { encoding: 'utf8' }).trim().split('\n').at(-1);
r.note('dispatcher replica restarted (attachment cache lost)', `${out} (${Date.now() - tr} ms)`);
await sleep(Number(process.env.POST_RESTART_MS ?? 5000));
const ex0 = executions(S);
const bob = await respond('public', S, p.action, 'allow', { key: k('bob'), actor: 'bob' });
r.note('READER bob answers', `${bob.status} ${bob.json?.error?.code ?? bob.json?.status ?? ''}`);
const ckey = k('carol');
const t0 = Date.now();
const carol = await respond('public', S, p.action, 'allow', { key: ckey, actor: 'carol' });
const replay = await respond('public', S, p.action, 'allow', { key: ckey, actor: 'carol' });
const opId = carol.json?.operation_id ?? carol.json?.operationId ?? carol.json?.id;
const opId2 = replay.json?.operation_id ?? replay.json?.operationId ?? replay.json?.id;
r.note('OPERATOR carol answers alice\'s approval / same-key replay', `${carol.status} ${opId} / ${replay.status} ${opId2}`);
const opq = () => sql(`SELECT state, COALESCE(error_code,''), attempt_count, delivery_state FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`)[0];
const actionState = () => sql(`SELECT state FROM managed_agent_action WHERE action_id='${A}'`)[0]?.[0];
let o = opq(); const seen = [];
for (let i = 0; i < 450 && !(o && ['COMPLETED', 'FAILED'].includes(o[0])); i++) { await sleep(200); o = opq(); if (seen.at(-1) !== j(o)) seen.push(j(o)); }
const settleMs = Date.now() - t0;
const end = await waitTurn(S, { timeoutMs: 60_000 });
await sleep(1000);
const file = readWs(ST, `child/a2-${tag}.txt`);
const calls = tapEntries().slice(mark).filter((e) => e.path?.startsWith(`/session/${S}`) && !e.path.endsWith('/heartbeat') && !e.path.endsWith('/events'))
  .map((e) => `${e.method} ${e.path.replace(S, ':id').replace(/actions\/[^/]+/, 'actions/:a')}${e.body?.passive !== undefined ? ` passive=${e.body.passive}` : ''} ${e.status ?? '-'}${e.upstreamBody?.error?.code ? ' ' + e.upstreamBody.error.code : e.upstreamBody?.code ? ' ' + e.upstreamBody.code : ''}`)
  .reduce((acc, x) => { const l = acc.at(-1); if (l && l[0] === x) l[1]++; else acc.push([x, 1]); return acc; }, []).map(([x, n]) => (n > 1 ? `${x} ×${n}` : x));
const resolves = tapEntries().slice(mark).filter((e) => e.path?.startsWith(`/session/${S}/actions/`) && e.path.endsWith('/resolve') && e.status >= 200 && e.status < 300).length;
r.note('answer operation states seen (state, error, attempts, delivery)', j(seen));
r.note('Harness calls for the Session after the restart', j(calls));
r.note('Turn', `${end.status} ${end.error ?? ''} ${end.timeout ? '(not terminal)' : ''}`);
r.note(`file child/a2-${tag}.txt / executions added`, `${file} / ${executions(S) - ex0}`);
r.check('READER is refused', bob.status >= 400 && bob.status < 500, `${bob.status}`);
r.check('second OPERATOR\'s answer is admitted and the same-key replay returns the same operation', [200, 202].includes(carol.status) && opId && opId === opId2, `${carol.status} ${opId} ${opId2}`);
r.check('the original operation completes and the Action is decided', o?.[0] === 'COMPLETED' && actionState() === 'decided', `${j(o)} action=${actionState()} at +${settleMs} ms`);
r.check('exactly one successful resolve reaches the Harness', resolves === 1, `${resolves}`);
r.check('the Turn completes and the approved write lands once', end.status === 'COMPLETED' && file === 'SECOND' && executions(S) - ex0 === 1, `${end.status} file=${file} executions+${executions(S) - ex0}`);
if (end.timeout) {
  const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: l2.json.turn_id }, { actor: 'alice', key: k('cleanup') });
  const e2 = await waitTurn(S, { timeoutMs: 60_000 });
  r.note('cleanup cancel', `${c.status} → ${e2.status}`);
}
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, bob: bob.status, carol: carol.status, replaySame: opId === opId2, op: o, settleMs, end: end.status, file, resolves, calls });
process.exit(0);
