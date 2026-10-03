// VERIFICATION RIG ONLY (PR #13179): stack smoke — a Workspace Session with one streamed turn, both arms render it.
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, api } from './lib.mjs';
import { launch, open, alertText, shot, counts, sleep } from './ui.mjs';
const r = new Report('p0-smoke');
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, 'UI_STREAM n=5 delay=20 tag=SMK');
r.check('session created', Boolean(c.session), `${c.status} ${c.session}`);
const t = await waitTurn(c.session);
r.check('turn completed', t.status === 'COMPLETED', j(t));
for (const [path, body] of [['/api/agent/web-shell/v1/sessions/get', { sessionId: c.session }], ['/api/agent/web-shell/v1/sessions/get', { sessionId: 'ses_00000000000000000000000000' }], ['/api/agent/web-shell/v1/transcript/query', { sessionId: 'ses_00000000000000000000000000', limit: 100 }]]) {
  const x = await api('POST', path, body);
  r.note(`${path} ${body.sessionId.slice(0, 12)}`, `${x.status} ${JSON.stringify(x.json).slice(0, 160)}`);
}
const nx = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: c.session }, { actor: null });
r.note('no actor header', `${nx.status} ${JSON.stringify(nx.json).slice(0, 160)}`);
const mal = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: c.session }, { actor: 'mallory' });
r.note('actor without access', `${mal.status} ${JSON.stringify(mal.json).slice(0, 160)}`);
const b = await launch();
for (const arm of ['base', 'head']) {
  const p = await open(b, { arm, session: c.session });
  await p.page.getByText('[SMK-0005]').first().waitFor({ timeout: 20_000 }).then(() => r.check(`${arm}: transcript rendered`, true), (e) => r.check(`${arm}: transcript rendered`, false, String(e).slice(0, 100)));
  await sleep(7000);
  r.note(`${arm}: requests in first 7 s`, j(counts(p.net)));
  r.note(`${arm}: alerts`, j(await alertText(p.page)));
  await shot(p.page, `p0-${arm}`);
  await p.context.close();
}
await b.close();
r.done({ session: c.session });
