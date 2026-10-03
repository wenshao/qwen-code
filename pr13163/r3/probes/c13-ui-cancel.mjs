// VERIFICATION RIG ONLY (PR #13163): the real Managed panel while a bound later Turn runs and the Workspace refuses
// new work. Is Cancel shown, does clicking it stop the Turn, and what does a reader (bob) see and get?
// usage: DB=<db> node c13-ui-cancel.mjs <workspace> <storage> <revoke|draining|regen|reader> <lang>
import { launch, open, shot, calls, sleep } from './ui.mjs';
import { api, sql, one, register, waitTurn, turnRow, readWs, modelEntries, Report, TENANT, j } from './lib.mjs';

const [WS, ST, MODE, LANG] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5] ?? 'en'];
const r = new Report(`c13-ui-${MODE}-${LANG}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const restore = () => { sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`); sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`); };
restore();
const k = (s) => `${s}-${WS}-${Date.now()}`;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=ui.txt tag=u0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const tag = `uic-${MODE}-${Date.now() % 100000}`;
const file = `late-${tag}.txt`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_SLOW name=${file} hold=60000 tag=${tag}` }] }, { actor: 'alice', key: k('slow') });
for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
if (MODE === 'revoke') sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
if (MODE === 'draining') sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE ${W}`);
if (MODE === 'regen') sql(`UPDATE managed_workspace_registry SET workspace_generation=workspace_generation+1 WHERE ${W}`);
const actor = MODE === 'reader' ? 'bob' : 'alice';
const browser = await launch();
const v = await open(browser, { arm: 'head', actor, lang: LANG, session: S });
await v.page.locator('[data-managed-workspace-binding]').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await sleep(2500);
const cancelBtn = v.page.getByRole('button', { name: /^(Cancel turn|取消本轮)$/ });
const composer = await v.page.locator('form textarea').count();
const n = await cancelBtn.count();
const caps = calls(v.net, '/sessions/get').at(-1)?.res?.capabilities;
await shot(v.page, `c13-${MODE}-1-before-${LANG}`);
r.note(`${actor} sees Cancel / composer / workspaceTurns`, `${n} / ${composer} / ${caps?.workspaceTurns}`);
let end = null;
let cancelCall = null;
if (n > 0) {
  const t0 = Date.now();
  await cancelBtn.first().click();
  await sleep(1500);
  cancelCall = calls(v.net, '/turns/cancel').at(-1);
  r.note('panel cancel request', `${cancelCall?.status} ${j(cancelCall?.req)} -> ${j(cancelCall?.res).slice(0, 160)}`);
  if (MODE !== 'reader') {
    end = await waitTurn(S, { timeoutMs: 30_000 });
    r.note('Turn after the click', `${end.status} at +${Date.now() - t0} ms`);
    await sleep(2000);
  }
  await shot(v.page, `c13-${MODE}-2-after-${LANG}`);
  const shown = await v.page.locator('body').innerText();
  r.note('refusal text visible on the page', `${/409|not allowed|unavailable|cannot|无法|不可/i.test(shown) ? 'yes' : 'no'}`);
}
await v.context.close();
await browser.close();
if (MODE === 'reader') {
  const turn = turnRow(S).at(-1);
  r.note('Turn after the reader\'s click', `${turn[1]}`);
  await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cleanup') });
  await waitTurn(S, { timeoutMs: 30_000 });
}
restore();
r.note('Workspace file', `${readWs(ST, `child/${file}`)}`);
r.done({ session: S, mode: MODE, actor, cancelButtons: n, composer, workspaceTurns: caps?.workspaceTurns, cancelStatus: cancelCall?.status ?? null, end: end?.status ?? null, file: readWs(ST, `child/${file}`) });
process.exit(0);
