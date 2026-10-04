// VERIFICATION RIG ONLY (PR #13163, round 4): the author's UI scenario. After w1-warm.mjs start (revoke-drain) and a
// Spring restart, open the real Managed panel as the creator, wait for the environment status, screenshot, click
// Cancel if shown, screenshot again.
// usage: DB=<db> node c17-ui-warm.mjs <workspace> <storage> <arm> <lang>
import fs from 'node:fs';
import { launch, open, shot, calls, sleep } from './ui.mjs';
import { api, sql, waitTurn, turnRow, Report, TENANT, RUN, j } from './lib.mjs';
const [WS, ST, ARM, LANG] = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(`${RUN}/w1-${WS}.json`, 'utf8'));
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const r = new Report(`c17-ui-warm-${ARM}-${LANG}-${WS}`);
const env = () => sql(`SELECT sequence_id, event_type, data_json FROM managed_agent_event WHERE session_id='${st.S}' AND turn_id='${st.T}' AND event_type LIKE 'environment.%' ORDER BY sequence_id`).map((x) => `${x[0]}:${x[1].replace('environment.', '')}${x[2] !== '{}' ? x[2] : ''}`);
for (let i = 0; i < 900 && !env().some((e) => e.includes(':failed')); i++) await sleep(100);
r.note('environment events before the panel opens', j(env()));
const browser = await launch();
const v = await open(browser, { arm: ARM, actor: 'alice', lang: LANG, session: st.S });
await v.page.locator('[data-managed-workspace-binding]').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await sleep(2500);
const btn = v.page.getByRole('button', { name: /^(Cancel turn|取消本轮)$/ });
const n = await btn.count();
const text0 = await v.page.locator('body').innerText();
await shot(v.page, `c17-${ARM}-1-before-${LANG}`);
r.note('Cancel shown / environment error text visible', `${n} / ${/runtime_warm_failed|Preparation failed|准备失败|环境/i.test(text0) ? 'yes' : 'no'}`);
let cc = null, end = null;
if (n) {
  const t0 = Date.now();
  await btn.first().click();
  await sleep(1500);
  cc = calls(v.net, '/turns/cancel').at(-1);
  end = await waitTurn(st.S, { timeoutMs: 60_000 });
  r.note('panel cancel request / Turn end', `${cc?.status} / ${end.status} at +${Date.now() - t0} ms`);
  await sleep(2500);
} else {
  end = { status: turnRow(st.S).at(-1)[1] };
}
await shot(v.page, `c17-${ARM}-2-after-${LANG}`);
const text1 = await v.page.locator('body').innerText();
const g = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: st.S }, { actor: 'alice' });
r.note('after: environment error text visible / WebShell environment', `${/runtime_warm_failed|Preparation failed|准备失败/i.test(text1) ? 'yes' : 'no'} / ${j(g.json.environment)}`);
await v.context.close();
await browser.close();
sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE ${W}`);
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE ${W} AND actor_id='alice'`);
if (!n) { await api('POST', `/v1/agents/sessions/${st.S}/events`, { type: 'agent.session.cancel', turn_id: st.T }, { actor: 'alice', key: `cleanup-${Date.now()}` }); await waitTurn(st.S, { timeoutMs: 60_000 }); }
r.note('Turn history', j(turnRow(st.S)));
r.done({ S: st.S, arm: ARM, cancel: n, cancelStatus: cc?.status ?? null, end: end?.status, env: env() });
process.exit(0);
