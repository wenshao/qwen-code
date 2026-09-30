// VERIFICATION RIG ONLY (PR #13107): exploratory run — dump what the real page shows for one pending approval.
// usage: DB=<db> node s0-explore.mjs [head|base] [marker]
import fs from 'node:fs';
import { api, ensureWorkspace, createSession, listActions, waitPending, waitTurn, readWs, sleep, j, RIG, DB , WS, ST } from './lib.mjs';
import { launch, open, selectSession, waitCard, waitNoCard, shot, card, calls, text, option } from './ui.mjs';

const arm = process.argv[2] ?? 'head';
const marker = process.argv[3] ?? `UI_WRITE name=explore-${Date.now().toString(36)}.txt content=approved-by-owner delay=6000`;
ensureWorkspace(WS, `st-${ST}`);
const browser = await launch();
const ui = await open(browser, { arm });
await sleep(1500);
const c = await createSession('web', WS, marker);
console.log('create', c.status, c.session);
await selectSession(ui.page, c.session);
console.log('selected; waiting for card');
const w = await waitCard(ui.page, { timeoutMs: 40_000 });
console.log('card', w);
await sleep(800);
await shot(ui.page, `explore-${arm}-pending`);
console.log('CARD TEXT:', await text(card(ui.page)));
console.log('CARD HTML:', (await card(ui.page).count()) ? (await card(ui.page).first().innerHTML()).slice(0, 3000) : null);
console.log('SECTION TEXT:', (await ui.page.locator('section').first().innerText()).replace(/\n+/g, ' | ').slice(0, 2500));
const p = await listActions('web', c.session);
console.log('ACTIONS:', j(p.json));
const tr = await api('POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: c.session, limit: 100 });
console.log('TRANSCRIPT status', tr.status, j(tr.json).slice(0, 3000));
console.log('NET so far:', ui.net.map((e) => `${e.path}:${e.status}`).join(' '));
if (w.ok) {
  const allow = option(ui.page, 'allow');
  console.log('allow button count', await allow.count());
  await allow.click();
  const gone = await waitNoCard(ui.page, { timeoutMs: 20_000 });
  console.log('card gone', gone);
  const t = await waitTurn(c.session, { timeoutMs: 60_000 });
  console.log('turn', t);
  await sleep(2500);
  await shot(ui.page, `explore-${arm}-after`);
  console.log('SECTION TEXT AFTER:', (await ui.page.locator('section').first().innerText()).replace(/\n+/g, ' | ').slice(0, 2500));
  console.log('RESPOND CALLS:', j(calls(ui.net, '/actions/respond')));
}
console.log('QUERY CALLS:', calls(ui.net, '/actions/query').length);
console.log('console errors:', j(ui.consoleErrors));
fs.writeFileSync(`${RIG}/out/${DB}-explore-${arm}-net.json`, JSON.stringify(ui.net, null, 1));
await browser.close();
process.exit(0);
