// VERIFICATION RIG ONLY (PR #13682): the real Managed WebShell panel answers a pending Workspace approval after the
// dispatcher replica restarted (attachment cache lost). Screenshot the card, click "allow once", watch the answer.
// usage: DB=<db> ARM=<h|b> RESTART_CMD='...' node p1-ui.mjs <workspace> <storage>
import { execSync } from 'node:child_process';
import { launch, open, shot, calls, card, waitCard, sleep } from './ui.mjs';
import { api, sql, one, register, waitTurn, turnRow, readWs, waitPending, respond, executions, Report, TENANT, j } from './lib.mjs';
const [WS, ST] = process.argv.slice(2);
const ARM = process.env.ARM ?? 'h';
const r = new Report(`p1-ui-${ARM}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const tag = Date.now() % 100000;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_WRITE name=a1-${tag}.txt content=first` }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = created.json.id;
let p = await waitPending(S, { timeoutMs: 60_000 });
const first = p.action.id;
await respond('public', S, p.action, 'allow', { key: k('allow1') });
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 60_000 })).status === 'COMPLETED', S);
await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_WRITE name=ui-${tag}.txt content=from-the-panel` }] }, { actor: 'alice', key: k('later') });
p = await waitPending(S, { timeoutMs: 60_000, not: [first] });
r.check('later Turn waits for approval', !p.timeout);
const out = execSync(process.env.RESTART_CMD, { encoding: 'utf8' }).trim().split('\n').at(-1);
r.note('dispatcher restarted (cold attachment cache)', out);
await sleep(4000);
const ex0 = executions(S);
const browser = await launch();
const v = await open(browser, { arm: ARM, actor: 'alice', lang: 'en', session: S, width: 1180, height: 820 });
const wc = await waitCard(v.page, { timeoutMs: 40_000 });
await sleep(1500);
await shot(v.page, `p1-ui-${ARM}-1-card`);
r.check('approval card is shown', wc.ok, `${wc.ms} ms`);
const allowOnce = card(v.page).locator('[data-option-id]').filter({ hasText: /allow once|允许一次/i });
const labels = await card(v.page).locator('[data-option-id]').allInnerTexts().catch(() => []);
r.note('card options', j(labels.map((x) => x.replace(/\s+/g, ' ').trim())));
const t0 = Date.now();
if (await allowOnce.count()) await allowOnce.first().click();
await sleep(1500);
const rc = calls(v.net, '/actions/respond').at(-1);
r.note('panel respond call', `${rc?.status} ${j(rc?.res ?? rc?.failure).slice(0, 200)}`);
const opq = () => sql(`SELECT state, COALESCE(error_code,''), attempt_count FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`)[0];
let o = opq();
for (let i = 0; i < 150 && !['COMPLETED', 'FAILED'].includes(o?.[0]); i++) { await sleep(200); o = opq(); }
const end = await waitTurn(S, { timeoutMs: 15_000 });
await sleep(2500);
await shot(v.page, `p1-ui-${ARM}-2-after`);
const file = readWs(ST, `child/ui-${tag}.txt`);
r.note('answer operation / Turn / file / executions added', `${j(o)} at +${Date.now() - t0} ms / ${end.status}${end.timeout ? ' (not terminal)' : ''} / ${file} / ${executions(S) - ex0}`);
r.check('the panel answer completes the Turn and writes the file once', o?.[0] === 'COMPLETED' && end.status === 'COMPLETED' && file === 'FROM-THE-PANEL', `${o?.[0]} ${end.status} ${file}`);
r.note('page console errors', j(v.consoleErrors.slice(0, 3)));
await v.context.close();
await browser.close();
if (end.timeout) {
  const turnId = turnRow(S).at(-1)[0];
  const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: turnId }, { actor: 'alice', key: k('cleanup') });
  const e2 = await waitTurn(S, { timeoutMs: 60_000 });
  r.note('cleanup cancel', `${c.status} → ${e2.status}`);
}
r.done({ session: S, arm: ARM, card: wc.ok, respond: rc?.status ?? null, op: o, end: end.status, file });
process.exit(0);
