// VERIFICATION RIG ONLY (PR #13682): a Harness-disabled replica (B: Session Store only, normal 1 s scan) must not
// claim a requested approval answer it cannot deliver. The answer is put in retry (tap 503), the dispatcher A is
// stopped, and B alone runs for WATCH ms. Then A comes back, the tap heals, and the answer must be delivered once.
// usage: DB=<db> STOP_CMD='...' START_CMD='...' BLOG=<B log> node p2-disabled-replica.mjs <workspace> <storage>
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, respond, setTapRules, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST] = process.argv.slice(2);
const WATCH = Number(process.env.WATCH ?? 20_000);
const r = new Report(`p2-disabled-replica-${WS}`);
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
await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=a2-${tag}.txt content=second`), { actor: 'alice', key: k('later2') });
p = await waitPending(S, { timeoutMs: 60_000, not: [first] });
r.check('later Turn waits for approval', !p.timeout);
const A = p.action.id;
const isResolve = (e) => e.path?.startsWith(`/session/${S}/actions/`) && e.path.endsWith('/resolve');
setTapRules([{ match: `POST /session/${S}/actions/.*/resolve`, action: 'respond', status: 503, body: { error: { code: 'rig_unavailable' } } }]);
await sleep(300);
const ans = await respond('public', S, p.action, 'allow', { key: k('allow2') });
for (let i = 0; i < 100 && !tapEntries().some((e) => isResolve(e) && e.fault === 'respond'); i++) await sleep(100);
const opq = () => sql(`SELECT state, delivery_state, attempt_count, available_at, COALESCE(lease_owner,''), COALESCE(error_code,'') FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`)[0];
const opId = one(`SELECT operation_id FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`);
r.note('answer admitted; first delivery got 503', `${ans.status}; op ${j(opq())}`);
execSync(process.env.STOP_CMD);
const before = opq();
const blogLines = () => (fs.existsSync(process.env.BLOG) ? fs.readFileSync(process.env.BLOG, 'utf8').split('\n').filter((l) => l.includes(opId)).length : 0);
const b0 = blogLines();
const t0 = Date.now(); const samples = [];
while (Date.now() - t0 < WATCH) { const o = opq(); if (j(samples.at(-1)?.o) !== j(o)) samples.push({ at: Date.now() - t0, o }); await sleep(250); }
const after = opq();
const bLines = blogLines() - b0;
r.note(`op row before B-only window`, j(before));
r.note(`op row changes during ${WATCH} ms with only B running (at ms: state, delivery, attempts, available_at, owner, error)`, j(samples.map((s) => [s.at, s.o.slice(0, 3).concat([s.o[3] - before[3], s.o[4] ? 'leased' : '', s.o[5]])])));
r.note('B log lines naming this operation', `${bLines}${bLines ? ' e.g. ' + (fs.readFileSync(process.env.BLOG, 'utf8').split('\n').filter((l) => l.includes(opId)).at(-1) ?? '').slice(0, 260) : ''}`);
r.check('B does not claim the requested answer (attempts/available_at unchanged)', after[2] === before[2] && after[3] === before[3], `attempts ${before[2]}→${after[2]}, available_at +${after[3] - before[3]} ms`);
// Bring A back and heal the Harness.
const out = execSync(process.env.START_CMD, { encoding: 'utf8' }).trim().split('\n').at(-1);
r.note('dispatcher A restarted', out);
setTapRules([]);
const t1 = Date.now();
const ex0 = executions(S);
let o = opq();
for (let i = 0; i < 600 && !['COMPLETED', 'FAILED'].includes(o?.[0]); i++) { await sleep(200); o = opq(); }
const settleMs = Date.now() - t1;
const end = await waitTurn(S, { timeoutMs: 60_000 });
await sleep(800);
const file = readWs(ST, `child/a2-${tag}.txt`);
const ok2xx = tapEntries().filter((e) => isResolve(e) && !e.fault && e.status >= 200 && e.status < 300).length;
r.note('after A returns and the tap heals', `op ${j(o)} at +${settleMs} ms; Turn ${end.status}; file ${file}; executions +${executions(S) - ex0}; successful resolves ${ok2xx - 1} (excluding the first Action)`);
r.check('the answer is delivered once and the Turn completes', o?.[0] === 'COMPLETED' && end.status === 'COMPLETED' && file === 'SECOND' && ok2xx - 1 === 1, `${o?.[0]} ${end.status} ${file} resolves=${ok2xx - 1}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, before, after, samples, bLines, settleMs, op: o, end: end.status, file, resolves: ok2xx - 1 });
process.exit(0);
