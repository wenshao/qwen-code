// VERIFICATION RIG ONLY (PR #13163 R5): b6eff8f4 on the real stack. A bound Turn is recovery-blocked in a live Harness
// (#13054 shape: first write lands, can_create revoked, second write refused), so the resident Session has no active
// prompt and one unsettled input ("parked"). Spring is restarted (cold attachment cache), then the creator cancels:
// the cancel's passive load takes the resident parked branch and acquires the original Runtime lease through a
// Broker tap that holds the acquire ANSWER (the Broker has already acted). Inside that window a teardown
// (DELETE /session/:id) is sent straight to the Harness, as a concurrent Spring teardown would.
// usage: DB=<db> node td-race.mjs start <ws> <st>      (then restart Spring)
//        DB=<db> node td-race.mjs race <ws> <st> <armLabel>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, turnRow, readWs, modelEntries, tapEntries, Report, sleep, TENANT, RUN, HARNESS, j } from './lib.mjs';
const [PHASE, WS, ST, ARM] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync('/root/v13163/rig/rig.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const STATE = `${RUN}/td-${WS}.json`;
const BTAP_LOG = `${RUN}/btap.jsonl`, BTAP_RULES = `${RUN}/btap-rules.json`;
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const k = (s) => `${s}-${WS}-${Date.now()}`;
const grant = (v) => sql(`UPDATE managed_workspace_access SET can_create=${v ? 'TRUE' : 'FALSE'} WHERE ${W} AND actor_id='alice'`);
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const harnessLog = () => fs.readdirSync(RUN).filter((f) => /^harness-\d+\.log$/.test(f)).map((f) => fs.readFileSync(`${RUN}/${f}`, 'utf8')).join('\n');
if (PHASE === 'start') {
  const r = new Report(`td-start-${WS}`);
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE ${W}`) === '0') register(WS, `st-${ST}`);
  grant(true);
  fs.writeFileSync(BTAP_RULES, '[]');
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=base.txt tag=t0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
  const S = c.json.id;
  r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
  const tag = `td-${Date.now() % 100000}`;
  const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_STEP name=one-${tag}.txt name2=two-${tag}.txt hold=6000 tag=${tag}` }] }, { actor: 'alice', key: k('step') });
  for (let i = 0; i < 400 && !modelEntries().some((e) => e.kind === 'STEP-hold' && e.tag === tag); i++) await sleep(100);
  const before = harnessLog().split('recovery blocked').length - 1;
  grant(false);
  let blocked = false;
  for (let i = 0; i < 300 && !blocked; i++) { blocked = harnessLog().split('recovery blocked').length - 1 > before; if (!blocked) await sleep(100); }
  await sleep(1500);
  r.check('Turn recovery-blocked in the live Harness', blocked, `Turn=${turnRow(S).at(-1)[1]} one=${readWs(ST, `child/one-${tag}.txt`)} two=${readWs(ST, `child/two-${tag}.txt`)}`);
  fs.writeFileSync(STATE, JSON.stringify({ S, turn: sub.json.turn_id, tag }));
  r.done({ S, turn: sub.json.turn_id, tag, blocked });
  process.exit(0);
}
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const r = new Report(`td-race-${ARM}${process.env.GRANT_BEFORE_CANCEL === '1' ? '-granted' : ''}-${WS}`);
const b0 = lines(BTAP_LOG).length, t0tap = tapEntries().length;
fs.writeFileSync(BTAP_RULES, JSON.stringify([{ match: 'POST .*tool-sessions:acquire', action: 'delay-after', delayMs: Number(process.env.HOLD_MS ?? 6000), times: 1 }]));
await sleep(300);
if (process.env.GRANT_BEFORE_CANCEL === '1') { grant(true); r.note('can_create restored just before the cancel', 'so the Broker admits the passive re-acquire'); }
const t0 = Date.now();
const cancel = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.cancel', turn_id: st.turn }, { actor: 'alice', key: k('cancel') });
r.note('creator cancel after the Spring restart (create still revoked)', `${cancel.status} ${cancel.json.status ?? cancel.json.error?.code}`);
// Wait until the Broker has ANSWERED the acquire (the tap logs it the moment the upstream answer is complete, then holds it).
let acq = null;
for (let i = 0; i < 900 && !acq; i++) { acq = lines(BTAP_LOG).slice(b0).find((e) => e.fault === 'delay-after'); if (!acq) await sleep(100); }
let del = null, delAt = null;
if (acq) {
  await sleep(500);
  delAt = Date.now() - t0;
  const caps = await fetch(`${HARNESS}/capabilities`, { headers: { Authorization: `Bearer ${env.HTOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1' } });
  const boot = (await caps.json())?.hostedHarness?.bootId;
  const res = await fetch(`${HARNESS}/session/${st.S}`, { method: 'DELETE', headers: { Authorization: `Bearer ${env.HTOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1', ...(boot ? { 'X-Qwen-Harness-Boot-Id': boot } : {}) } });
  del = { status: res.status, body: (await res.text()).slice(0, 300) };
}
r.note('Broker acquire answered (answer held by the tap)', acq ? `at +${Date.parse(acq.t) - t0} ms status=${acq.status} held=${acq.heldMs} ms` : 'never (no passive acquire reached the Broker)');
r.note('concurrent teardown DELETE /session/:id straight to the Harness', del ? `at +${delAt} ms -> ${del.status} ${del.body}` : 'not sent');
const end = await waitTurn(st.S, { timeoutMs: Number(process.env.WAIT_MS ?? 75_000) });
await sleep(1000);
const brokerCalls = lines(BTAP_LOG).slice(b0).map((e) => `${e.method} ${e.path.replace(/\?.*/, '').replace(/[0-9a-f-]{36}/g, ':id')} ${e.status ?? '-'}${e.upstreamBody?.code ? ' ' + e.upstreamBody.code : ''}${e.fault ? ' [' + e.fault + ']' : ''}`);
const harnessCalls = tapEntries().slice(t0tap).filter((e) => e.path?.startsWith(`/session/${st.S}`) && !e.path.endsWith('/events') && !e.path.endsWith('/heartbeat')).map((e) => `${e.method} ${e.path.replace(st.S, ':id')} ${e.status ?? '-'}${e.upstreamBody?.code ? ' ' + e.upstreamBody.code : ''}${e.body?.passiveManagedRuntimeRecovery ? ' passive' : ''}${e.body?.driveRuntimeRecovery ? ' drive' : ''}`);
const lines13 = harnessLog().split('\n').filter((l) => l.includes(st.S) || l.includes('stranded') || l.includes('owed') || l.includes('runtime_session_not_acquirable')).slice(-12).map((l) => l.slice(0, 260));
r.note('Turn end', `${end.status} ${end.error} ${end.timeout ? '(not terminal)' : `at +${Date.now() - t0 - 1000} ms`}`);
r.note('Broker calls through the tap since the cancel', j(brokerCalls));
r.note('Spring -> Harness calls for the Session since the cancel', j(harnessCalls));
r.note('Harness stderr for the Session', j(lines13));
let rt = [];
try { rt = sql(`SELECT RIGHT(runtime_session_id, 12), session_state, record_version, last_active_at FROM qwen_runtime_session WHERE harness_session_id='${st.S}' ORDER BY last_active_at`); } catch (e) { rt = [[String(e).slice(0, 120)]]; }
r.note('Runtime Session records', j(rt));
fs.writeFileSync(BTAP_RULES, '[]');
grant(true);
const after = await waitTurn(st.S, { timeoutMs: 30_000 });
r.note('Turn 30 s after can_create restored', `${after.status} ${after.error} ${after.timeout ? '(not terminal)' : ''}`);
r.note('Turn history', j(turnRow(st.S)));
r.done({ ...st, arm: ARM, cancel: cancel.status, acquireAnswered: !!acq, del, delAt, end, brokerCalls, harnessCalls, runtime: rt, after: after.status });
process.exit(0);
