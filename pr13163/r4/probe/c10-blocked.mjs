// VERIFICATION RIG ONLY (PR #13163): a later Turn has acquired the Workspace (first write done); can_create is revoked
// while the model is between tool calls; the second write hits the Broker refusal. Does the Harness block the Turn,
// and can the creator's cancel end it (MODE=revoked: cancel while still revoked; MODE=restored: restore, then cancel)?
// usage: DB=<db> node c10-blocked.mjs <workspace> <storage> <revoked|restored|none>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, modelEntries, Report, sleep, TENANT, RUN, j } from './lib.mjs';
const [WS, ST, MODE] = [process.argv[2], process.argv[3], process.argv[4] ?? 'revoked'];
const r = new Report(`c10-blocked-${MODE}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const grant = (v) => sql(`UPDATE managed_workspace_access SET can_create=${v ? 'TRUE' : 'FALSE'} WHERE ${W} AND actor_id='alice'`);
grant(true);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const harnessLog = () => fs.readdirSync(RUN).filter((f) => /^harness-\d+\.log$/.test(f)).map((f) => fs.readFileSync(`${RUN}/${f}`, 'utf8')).join('\n');
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=base.txt tag=b0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const tag = `blk-${MODE}-${Date.now() % 100000}`;
const [f1, f2] = [`one-${tag}.txt`, `two-${tag}.txt`];
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_STEP name=${f1} name2=${f2} hold=6000 tag=${tag}` }] }, { actor: 'alice', key: k('step') });
for (let i = 0; i < 400 && !modelEntries().some((e) => e.kind === 'STEP-hold' && e.tag === tag); i++) await sleep(100);
r.note('first write landed, model holding before the second', `${f1}=${readWs(ST, `child/${f1}`)}`);
const before = harnessLog().split('recovery blocked').length - 1;
grant(false);
const t0 = Date.now();
let blocked = false;
for (let i = 0; i < 300 && !blocked; i++) { blocked = harnessLog().split('recovery blocked').length - 1 > before; if (!blocked) await sleep(100); }
const tb = Date.now() - t0;
await sleep(2000);
r.note('second write vs revoked grant', `Harness "recovery blocked"=${blocked} at +${tb} ms; Turn=${turnRow(S).at(-1)[1]}; ${f2}=${readWs(ST, `child/${f2}`)}`);
let cancel = null;
if (MODE === 'restored') { grant(true); await sleep(1000); }
if (MODE !== 'none') {
  cancel = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cancel') });
  r.note(`creator cancel (${MODE})`, `${cancel.status} ${cancel.json.status ?? cancel.json.error?.code}`);
}
const end = await waitTurn(S, { timeoutMs: 70_000 });
r.note('Turn after 70 s', `${end.status} ${end.error} ${end.timeout ? '(still not terminal)' : ''}`);
grant(true);
const next = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'PLAIN next' }] }, { actor: 'alice', key: k('next') });
r.note('next later Turn', `${next.status} ${next.json.error?.code ?? next.json.turn_id}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, mode: MODE, blocked, blockedAt: tb, cancel: cancel?.status ?? null, end, next: next.status, nextCode: next.json.error?.code ?? null });
process.exit(0);
