// VERIFICATION RIG ONLY (PR #13163): what the creator sees in the real Managed panel while a bound later Turn runs,
// before and after can_create is revoked, and after the API cancel this PR admits.
// usage: DB=<db> node c9-ui.mjs <workspace> <storage> <lang>
import { launch, open, shot, calls, sleep } from './ui.mjs';
import { api, sql, one, register, waitTurn, turnRow, readWs, modelEntries, Report, TENANT, j } from './lib.mjs';

const [WS, ST, LANG] = [process.argv[2], process.argv[3], process.argv[4] ?? 'en'];
const r = new Report(`c9-ui-${LANG}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=ui.txt tag=u0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const tag = `ui-${Date.now() % 100000}`;
const file = `late-${tag}.txt`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_SLOW name=${file} hold=120000 tag=${tag}` }] }, { actor: 'alice', key: k('slow') });
for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);

const browser = await launch();
const cancelButton = (page) => page.getByRole('button', { name: /^(Cancel turn|取消本轮)$/ });
async function view(name) {
  const v = await open(browser, { arm: 'head', actor: 'alice', lang: LANG, session: S });
  await v.page.locator('[data-managed-workspace-binding]').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await sleep(2500);
  const n = await cancelButton(v.page).count();
  const caps = calls(v.net, '/sessions/get').at(-1)?.res?.capabilities;
  const file = await shot(v.page, `${name}-${LANG}`);
  await v.context.close();
  return { cancelButtons: n, caps, file };
}
const v1 = await view('ui-01-running-granted');
r.note('running, grants intact: Cancel buttons / capabilities', `${v1.cancelButtons} ${j(v1.caps)}`);
sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
const v2 = await view('ui-02-running-revoked');
r.note('running, can_create revoked: Cancel buttons / capabilities', `${v2.cancelButtons} ${j(v2.caps)}`);
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cancel') });
const end = await waitTurn(S, { timeoutMs: 60_000 });
r.note('API cancel by the creator while revoked', `${c.status} ${c.json.status ?? c.json.error?.code}; Turn ${end.status}`);
const v3 = await view('ui-03-cancelled-revoked');
r.note('after the API cancel: Cancel buttons', `${v3.cancelButtons}`);
await browser.close();
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE ${W} AND actor_id='alice'`);
r.note('Workspace file', `${readWs(ST, `child/${file}`)}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, v1, v2, v3, cancel: c.status, end: end.status });
process.exit(0);
