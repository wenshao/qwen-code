// VERIFICATION RIG ONLY (PR #13163, round 9): this PR's refused-authority cancel racing a Session delete.
// A bound later Turn holds its model request; the creator loses can_create; the creator cancels and then deletes
// the Session (MODE=delete) or closes it (MODE=close) while the cancellation settles. Nothing may wedge: the
// Turn must reach a terminal state, the model request must be aborted, and the delete/close must eventually be
// answered with a terminal outcome rather than an endless 409.
// usage: DB=<db> node c24-cancel-delete.mjs <workspace> <storage> <delete|close> [gapMs]
import { api, sql, one, register, waitTurn, turnRow, readWs, modelEntries, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST, MODE, GAP] = process.argv.slice(2);
const r = new Report(`c24-cancel-${MODE}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const c0 = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=d.txt tag=d0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = c0.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const tag = `del-${MODE}-${Date.now() % 100000}`;
const file = `late-${tag}.txt`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_SLOW name=${file} hold=90000 tag=${tag}` }] }, { actor: 'alice', key: k('slow') });
for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
r.check('later Turn holds its model request', modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag));
sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
const t0 = Date.now();
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cancel') });
r.note('creator cancel under the revoked grant', `${c.status} ${c.json?.status ?? c.json?.error?.code ?? ''}`);
await sleep(Number(GAP ?? 300));
const codes = [];
let d;
const dkey = k(MODE);
for (let i = 0; i < 120; i++) {
  d = MODE === 'delete'
    ? await api('DELETE', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice', key: dkey })
    : await api('POST', `/v1/agents/sessions/${S}/close`, {}, { actor: 'alice', key: dkey });
  codes.push(`${d.status}${d.json?.error?.code ? ':' + d.json.error.code : ''}`);
  if (d.status !== 409 && d.status < 500) break;
  await sleep(500);
}
const dMs = Date.now() - t0;
const end = await waitTurn(S, { timeoutMs: 60_000 });
await sleep(1500);
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === tag);
const sess = sql(`SELECT status, COALESCE(deleted_at,'') FROM managed_agent_session WHERE session_id='${S}'`)[0];
const harnessCalls = [...new Set(tapEntries().filter((e) => e.path?.startsWith(`/session/${S}`) && Date.parse(e.t) >= t0 && !e.path.endsWith('/events') && !e.path.endsWith('/heartbeat')).map((e) => `${e.method} ${e.path.replace(S, ':id')} ${e.status ?? '-'}`))];
const compact = codes.reduce((acc, x) => { const last = acc.at(-1); if (last && last[0] === x) last[1]++; else acc.push([x, 1]); return acc; }, []).map(([x, n]) => (n > 1 ? `${x}×${n}` : x));
r.note(`${MODE} attempts after the cancel (status sequence)`, `${j(compact)} final at +${dMs} ms`);
r.note('Turn after the cancel', `${end.status} ${end.error ?? ''} ${end.timeout ? '(not terminal)' : `at +${end.ms} ms`}`);
r.note('Session row (status, deleted_at)', j(sess));
r.note('held model request', aborted ? `aborted after ${aborted.heldMs} ms` : 'still held / answered');
r.note('Harness calls for the Session since the cancel', j(harnessCalls));
r.note('Workspace file of the cancelled Turn', `${readWs(ST, `child/${file}`)}`);
r.check('cancel admitted for the creator under the revoked grant', c.status === 202, `${c.status}`);
r.check('the Turn reaches a terminal state (no wedge)', !end.timeout && ['CANCELLED', 'FAILED', 'COMPLETED'].includes(end.status), end.status);
r.check(`${MODE} is answered terminally (not an endless 409/5xx)`, d.status < 300 || (d.status >= 400 && d.status !== 409 && d.status < 500), compact.join(','));
r.check('the held model request is aborted', !!aborted, aborted ? `${aborted.heldMs} ms` : 'not aborted');
r.check('the cancelled Turn wrote nothing', readWs(ST, `child/${file}`) === null);
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE ${W} AND actor_id='alice'`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, mode: MODE, cancel: c.status, attempts: compact, final: d.status, end: end.status, sessionRow: sess, aborted: aborted?.heldMs ?? null });
process.exit(0);
