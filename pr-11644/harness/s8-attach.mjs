// S8 — draft chat: attach an image, then submit a project-Skill slash command
// without browsing suggestions. Oracle: the mock provider's log of how many
// image parts the model request carried for this run's marker.
import fs from 'node:fs';
import { launch, openUi, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const marker = `MRK-${arm}-${Date.now()}`;
const { browser, page, reqs } = await launch();
await openUi(page);
await sleep(8_000);
await page.getByRole('button', { name: 'Add to message' }).click();
await page.locator('[data-testid=composer-add-menu-file]').click();
const chooserP = page.waitForEvent('filechooser');
await page.locator('[data-testid=composer-add-menu-file-attach]').click();
const chooser = await chooserP;
await chooser.setFiles('/root/git/h11289/probe-image.png');
await sleep(1_500);
const chips = await page.locator('img[src^="data:image"], img[src^="blob:"]').count();
const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
await editor.click();
await page.keyboard.insertText(`/release-notes ${marker}`);
await sleep(300);
const menuOpen = await page.locator('[data-web-shell-slash-menu]').isVisible().catch(() => false);
if (menuOpen) { await page.keyboard.press('Escape'); await sleep(200); }
await page.screenshot({ path: `/root/git/h11644/shots/s8-${arm}-before-send.png` });
const tSend = Date.now();
await page.keyboard.press('Enter');
let line;
for (let i = 0; i < 120 && !line; i++) {
  await sleep(500);
  line = fs.readFileSync('/root/git/h11644/mock.log', 'utf8').split('\n').find((l) => l.includes(marker));
}
await sleep(3_000);
await page.screenshot({ path: `/root/git/h11644/shots/s8-${arm}-after-send.png` });
const cmdReads = reqs.filter((r) => /\/commands|supported-commands|supportedCommands/.test(r.path) && r.t >= tSend - (Date.now() - tSend) - 1);
const res = { arm, marker, attachedChipsBeforeSend: chips, slashMenuOpenAfterInsert: menuOpen, mockLine: line ?? null, commandReadsAfterSend: reqs.filter((r) => /command/i.test(r.path)).map((r) => `${r.t}ms ${r.method} ${r.path}`) };
save(`s8-${arm}`, { ...res, reqs });
console.log(JSON.stringify(res, null, 2));
await browser.close();
