// S12 — b27c100ea7: an EXISTING session whose command snapshot is unknown
// (supported-commands fails) submits image + unresolved Skill slash command.
// The classification read fails before admission; is the unsent text/image restored?
import fs from 'node:fs';
import { launch, openUi, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const marker = `MRK12-${arm}-${Date.now()}`;
const { browser, context, page, reqs } = await launch();
let failCommands = false;
let cmdCalls = 0;
await context.route('**/session/*/supported-commands', async (route) => {
  cmdCalls++;
  if (failCommands) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'injected supported-commands failure', code: 'injected' }) });
  return route.continue();
});
await openUi(page);
await sleep(6_000);
const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
await editor.click();
const seed = `seed s12 ${arm} ${Date.now()}`;
await page.keyboard.type(seed, { delay: 10 });
await page.keyboard.press('Enter');
await page.getByText(new RegExp(`ACK<${seed}`)).first().waitFor({ timeout: 60_000 });
await sleep(2_000);
// reload with the command snapshot unavailable, then reopen that session
failCommands = true;
await page.reload();
await page.getByRole('complementary').first().waitFor();
await sleep(4_000);
await page.getByRole('complementary').getByRole('button', { name: new RegExp(`^${seed}`) }).first().click();
await page.getByText(new RegExp(`ACK<${seed}`)).first().waitFor({ timeout: 30_000 });
await sleep(3_000);
const callsBeforeSubmit = cmdCalls;
await page.getByRole('button', { name: 'Add to message' }).click();
await page.locator('[data-testid=composer-add-menu-file]').click();
const chooserP = page.waitForEvent('filechooser');
await page.locator('[data-testid=composer-add-menu-file-attach]').click();
await (await chooserP).setFiles('/root/git/h11289/probe-image.png');
await sleep(1_200);
const composer = page.locator('[data-web-shell-composer-editor]').first();
const chipsBefore = await page.locator('[data-web-shell-composer] img').count();
await editor.click();
await page.keyboard.insertText(`/release-notes ${marker}`);
await sleep(300);
if (await page.locator('[data-web-shell-slash-menu]').isVisible().catch(() => false)) { await page.keyboard.press('Escape'); await sleep(200); }
await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s12-${arm}-before.png` });
await page.keyboard.press('Enter');
await sleep(4_000);
const textAfter = (await editor.innerText()).trim();
const chipsAfter = await page.locator('[data-web-shell-composer] img').count();
const alerts = await page.locator('[role=alert], [role=status], [data-sonner-toast], li[data-type]').allInnerTexts().catch(() => []);
await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s12-${arm}-after.png` });
const modelSaw = fs.readFileSync('/root/git/h11644/mock.log', 'utf8').includes(marker);
const res = { arm, marker, callsBeforeSubmit, cmdCallsTotal: cmdCalls, chipsBefore, chipsAfter, textAfter, restoredText: textAfter.includes(marker), modelSawMarker: modelSaw, alerts: alerts.map((a) => a.replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean).slice(0, 6) };
save(`s12-${arm}`, res);
console.log(JSON.stringify(res, null, 2));
await browser.close();
