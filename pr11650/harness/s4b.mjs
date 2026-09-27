// 4b: switch to a new task while the edit is still fetching rewind snapshots.
// 4c: the rewound frame never arrives; the user reloads (the documented remedy).
import { open, typeAndSend, waitText, sleep, rows, assistantLines, shot, mkLog, openEditor, composerText, modelLog, PORTS } from './lib.mjs';
const arm = process.argv[2] ?? 'after';
const log = mkLog(`s4b-${arm}`);
const { browser, page, net } = await open(arm);
let delaySnapshots = false;
await page.route('**/session/*/rewind/snapshots', async (route) => {
  if (delaySnapshots) { delaySnapshots = false; await sleep(3000); }
  await route.continue();
});
await typeAndSend(page, 'ALPHA first question');
await waitText(page, 'Reply to ALPHA');
await sleep(800);
await typeAndSend(page, 'SIERRA second question');
await waitText(page, 'Reply to SIERRA');
await sleep(1500);
const oldUrl = page.url();
await openEditor(page);
await page.fill('textarea[aria-label="Edit message"]', 'TANGO must not be sent anywhere');
delaySnapshots = true;
const nModel0 = modelLog(arm).filter((r) => r.isMain).length;
const t0 = Date.now();
await page.keyboard.press('Enter');
await sleep(700);
await page.getByRole('button', { name: 'New task' }).first().click().catch(async () => page.getByText('New task').first().click());
await sleep(5000);
log('4b url after switch', page.url() === oldUrl ? 'same session' : 'new task view');
log('4b requests after Enter', net.filter((r) => r.t >= t0 && /rewind|prompt$/.test(r.u) && r.m !== 'OPTIONS').map((r) => `${r.m} ${r.u.replace(/[0-9a-f-]{36}/, ':id')}`));
log('4b rows in new view', await rows(page));
log('4b composer in new view', JSON.stringify(await composerText(page)));
log('4b model main requests', modelLog(arm).filter((r) => r.isMain).length - nModel0);
await page.goto(oldUrl);
await waitText(page, 'Reply to SIERRA', 60000);
await sleep(2000);
log('4b old session rows', await rows(page));
await shot(page, `s4b-${arm}-0-old-session-intact`);
// 4c: lost rewound frame
await page.locator('[data-web-shell-composer-editor] .cm-content').click();
await page.keyboard.type('UNRELATED DRAFT');
await openEditor(page);
await page.fill('textarea[aria-label="Edit message"]', 'UNIFORM edit whose sync never arrives');
await fetch(`http://127.0.0.1:${PORTS[arm].proxy}/__probe/arm?delayRewoundMs=600000`);
await page.keyboard.press('Enter');
await sleep(6000);
log('4c rows while blocked', await rows(page));
log('4c toasts', await page.$$eval('[data-web-shell-toast]', (ts) => ts.map((t) => t.innerText.replace(/\s+/g, ' ').trim())));
log('4c submit disabled', await page.evaluate(() => document.querySelector('[data-web-shell-composer-submit]')?.hasAttribute('disabled')));
await shot(page, `s4c-${arm}-0-lost-frame-blocked`);
await page.reload();
await waitText(page, 'Reply to ALPHA', 60000);
await sleep(3000);
log('4c rows after reload', await rows(page));
log('4c composer after reload', JSON.stringify(await composerText(page)));
log('4c edit text anywhere on page?', await page.evaluate(() => document.body.innerText.includes('UNIFORM')));
await shot(page, `s4c-${arm}-1-after-reload`);
await fetch(`http://127.0.0.1:${PORTS[arm].proxy}/__probe/arm?delayRewoundMs=0`);
await browser.close();
process.exit(0);
