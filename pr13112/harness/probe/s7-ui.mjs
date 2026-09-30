// VERIFICATION RIG ONLY (PR #13112): the real Managed panel on a bound Session, as the creator and as a reader.
// usage: DB=<db> node s7-ui.mjs <arm: head|base> <session> <storage>
import fs from 'node:fs';
import { launch, open, shot, calls, text, sleep } from './ui.mjs';
import { waitTurn, turnRow, readWs, modelEntries, Report, RIG, DB, j } from './lib.mjs';

const [ARM, S, ST] = [process.argv[2] ?? 'head', process.argv[3], process.argv[4] ?? 'a'];
const r = new Report(`s7-ui-${ARM}`);
const browser = await launch();
const prompt = (page) => page.getByRole('textbox', { name: /Prompt|Message|提示|消息|Ask/i }).first();
const composer = (page) => page.locator('form textarea');
const banner = (page) => page.locator('[data-managed-workspace-binding]');

async function view(actor, lang = 'en') {
  const v = await open(browser, { arm: ARM, actor, lang, session: S });
  await banner(v.page).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await sleep(1500);
  return v;
}

// creator
const a = await view('alice');
const bannerText = await text(banner(a.page));
const hasComposer = (await composer(a.page).count()) > 0;
r.note('creator: binding banner text', bannerText);
r.check(`creator (${ARM}): composer ${ARM === 'head' ? 'shown' : 'hidden'}`, hasComposer === (ARM === 'head'), `composer=${hasComposer}`);
await shot(a.page, `${ARM}-01-creator-bound-${DB}`);
const get = calls(a.net, '/sessions/get').at(-1);
r.note('creator: sessions/get capabilities seen by the page', j(get?.res?.capabilities));

if (ARM === 'head' && hasComposer) {
  const before = turnRow(S).length;
  await composer(a.page).fill('G_FILES name=ui.txt tag=ui1');
  await a.page.getByRole('button', { name: /^Send$/ }).click();
  const t = await waitTurn(S, { timeoutMs: 90_000 });
  r.check('creator sends a later Turn from the panel -> COMPLETED, ui.txt written', turnRow(S).length === before + 1 && t.status === 'COMPLETED' && readWs(ST, 'child/ui.txt') === 'after-ui1', `${j(t)} ${readWs(ST, 'child/ui.txt')}`);
  const submit = calls(a.net, '/turns/submit').at(-1);
  r.check('the panel used turns/submit -> 202', submit?.status === 202, `${submit?.status} ${j(submit?.req)}`);
  await a.page.getByText(/G_DONE tag=ui1/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await sleep(1000);
  r.check('the reply of the later Turn is in the transcript', (await a.page.getByText(/G_DONE tag=ui1/).count()) > 0, '');
  await shot(a.page, `${ARM}-02-creator-after-later-turn-${DB}`);

  // cancel from the panel
  await composer(a.page).fill('G_HOLD tag=ui-hold');
  await a.page.getByRole('button', { name: /^Send$/ }).click();
  for (let i = 0; i < 200 && !modelEntries().some((e) => e.kind === 'HOLD' && e.tag === 'ui-hold'); i++) await sleep(150);
  const cancelBtn = a.page.getByRole('button', { name: /^Cancel( turn)?$/ });
  await cancelBtn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  r.check('Cancel button shown while the later Turn runs', (await cancelBtn.count()) > 0, '');
  await shot(a.page, `${ARM}-03-creator-running-cancel-${DB}`);
  if (await cancelBtn.count()) {
    await cancelBtn.click();
    const tc = await waitTurn(S, { timeoutMs: 40_000 });
    const cancelCall = calls(a.net, '/turns/cancel').at(-1);
    r.check('Cancel from the panel -> turns/cancel 202, Turn CANCELLED', cancelCall?.status === 202 && tc.status === 'CANCELLED', `${cancelCall?.status} ${j(tc)}`);
    await sleep(2500);
    await shot(a.page, `${ARM}-04-creator-cancelled-${DB}`);
  }
  r.note('creator console errors', j(a.consoleErrors));
  // zh view of the creator
  const z = await view('alice', 'zh');
  r.note('creator (zh): binding banner text', await text(banner(z.page)));
  await shot(z.page, `${ARM}-05-creator-zh-${DB}`);
  await z.context.close();
}
await a.context.close();

// reader
const b = await view('bob');
const bComposer = (await composer(b.page).count()) > 0;
r.check(`reader (${ARM}): no composer`, !bComposer, `composer=${bComposer}`);
r.note('reader: sessions/get capabilities', j(calls(b.net, '/sessions/get').at(-1)?.res?.capabilities));
await shot(b.page, `${ARM}-06-reader-bound-${DB}`);
await b.context.close();
await browser.close();
r.done();
process.exit(r.fail ? 1 : 0);
