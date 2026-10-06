// VERIFICATION RIG ONLY (PR #13163 R5): round 5's "fence lifted early by an overlapping passive load", on the real
// stack. Same parked (recovery-blocked) Turn as td-race.mjs "start", replica A restarted, can_create restored, creator
// cancels. Spring's passive load L1 adopts with its acquire answer held 5 s; a second passive load L2 (same body Spring
// sends) is sent straight to the Harness with its acquire answer held 15 s. As soon as L1 has answered (its finally
// clears resident.mcpRecovering) a DELETE /session/:id is sent while L2 is still adopting.
// usage: DB=<db> node td-overlap.mjs <ws> <st> <armLabel>
import fs from 'node:fs';
import { api, sql, waitTurn, turnRow, tapEntries, Report, sleep, TENANT, RUN, HARNESS, j } from './lib.mjs';
const [WS, ST, ARM] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync('/root/v13163/rig/rig.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const st = JSON.parse(fs.readFileSync(`${RUN}/td-${WS}.json`, 'utf8'));
const BTAP_LOG = `${RUN}/btap.jsonl`, BTAP_RULES = `${RUN}/btap-rules.json`;
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const r = new Report(`td-overlap-${ARM}-${WS}`);
const H = { Authorization: `Bearer ${env.HTOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1' };
const boot = (await (await fetch(`${HARNESS}/capabilities`, { headers: H })).json()).hostedHarness.bootId;
const HB = { ...H, 'X-Qwen-Harness-Boot-Id': boot, 'Content-Type': 'application/json' };
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE ${W} AND actor_id='alice'`);
const b0 = lines(BTAP_LOG).length, t0tap = tapEntries().length;
fs.writeFileSync(BTAP_RULES, JSON.stringify([
  { match: 'POST .*tool-sessions:acquire', action: 'delay-after', delayMs: 5000, times: 1 },
  { match: 'POST .*tool-sessions:acquire', action: 'delay-after', delayMs: 15000, times: 1 },
]));
await sleep(300);
const t0 = Date.now();
const at = () => `+${Date.now() - t0} ms`;
const cancel = await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.cancel', turn_id: st.turn }, { actor: 'alice', key: `cancel-${Date.now()}` });
r.note('creator cancel (create restored, cold cache)', `${cancel.status} ${cancel.json.status ?? cancel.json.error?.code}`);
const held = () => lines(BTAP_LOG).slice(b0).filter((e) => e.fault === 'delay-after');
for (let i = 0; i < 1200 && held().length < 1; i++) await sleep(100);
if (!held().length) { r.note('no passive acquire reached the Broker'); r.done({}); process.exit(0); }
r.note('L1 (Spring) acquire answered by the Broker, answer held 5 s', at());
const body = { managedSessionStore: { baseUrl: `http://127.0.0.1:${env.SPRING_B_PORT}`, tenantId: TENANT, workspaceId: WS, writerId: boot, leaseDurationMs: 60000 }, passiveManagedRuntimeRecovery: true, toolProfile: 'hosted-workspace-files/1' };
const l2 = fetch(`${HARNESS}/session/${st.S}/load`, { method: 'POST', headers: HB, body: JSON.stringify(body) }).then(async (res) => ({ status: res.status, body: (await res.text()).slice(0, 200), at: at() }));
for (let i = 0; i < 100 && held().length < 2; i++) await sleep(50);
r.note('L2 (overlapping passive load) acquire answered, answer held 15 s', held().length >= 2 ? at() : 'NOT reached');
const del1 = await fetch(`${HARNESS}/session/${st.S}`, { method: 'DELETE', headers: HB });
r.note('DELETE while both loads adopt', `${at()} -> ${del1.status} ${(await del1.text()).slice(0, 120)}`);
const l1done = () => tapEntries().slice(t0tap).find((e) => e.path === `/session/${st.S}/load` && e.body?.passiveManagedRuntimeRecovery);
for (let i = 0; i < 400 && !l1done(); i++) await sleep(25);
const l1 = l1done();
r.note('L1 answered Spring', l1 ? `${at()} -> ${l1.status} ${l1.upstreamBody?.code ?? ''}` : 'not seen');
const del2 = await fetch(`${HARNESS}/session/${st.S}`, { method: 'DELETE', headers: HB });
r.note('DELETE right after L1 answered, L2 still adopting', `${at()} -> ${del2.status} ${(await del2.text()).slice(0, 120)}`);
const l2r = await l2;
r.note('L2 answer', `${l2r.at} -> ${l2r.status} ${l2r.body}`);
const end = await waitTurn(st.S, { timeoutMs: 75_000 });
await sleep(1000);
const brokerCalls = lines(BTAP_LOG).slice(b0).map((e) => `${e.method} ${e.path.replace(/\?.*/, '').replace(/[0-9a-f-]{36}/g, ':id')} ${e.status ?? '-'}${e.upstreamBody?.code ? ' ' + e.upstreamBody.code : ''}${e.fault ? ' [' + e.fault + ']' : ''}`);
const harnessCalls = tapEntries().slice(t0tap).filter((e) => e.path?.startsWith(`/session/${st.S}`) && !e.path.endsWith('/events') && !e.path.endsWith('/heartbeat')).map((e) => `${e.method} ${e.path.replace(st.S, ':id')} ${e.status ?? '-'}${e.upstreamBody?.code ? ' ' + e.upstreamBody.code : ''}${e.body?.passiveManagedRuntimeRecovery ? ' passive' : ''}`);
r.note('Turn end', `${end.status} ${end.error} ${end.timeout ? '(not terminal)' : `at ${at()}`}`);
r.note('Broker calls through the tap since the cancel', j(brokerCalls));
r.note('Spring -> Harness calls since the cancel', j(harnessCalls));
r.note('Runtime Session records', j(sql(`SELECT RIGHT(runtime_session_id, 12), session_state, record_version FROM qwen_runtime_session WHERE harness_session_id='${st.S}' ORDER BY last_active_at`)));
fs.writeFileSync(BTAP_RULES, '[]');
r.note('Turn history', j(turnRow(st.S)));
r.done({ arm: ARM, cancel: cancel.status, del1: del1.status, del2: del2.status, l1: l1?.status ?? null, l2: l2r, end, brokerCalls, harnessCalls });
process.exit(0);
