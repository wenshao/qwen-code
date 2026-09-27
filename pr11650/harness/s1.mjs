import fs from 'node:fs';
import { open, typeAndSend, waitText, sleep, rows, openEditor, composerText, assistantLines, shot, mkLog, modelLog, proxyLog } from './lib.mjs';
const arm = process.argv[2] ?? 'after';
const WS = `/var/tmp/pr11650/ws-${arm}`;
const log = mkLog(`s1-${arm}`);
const { browser, page, net } = await open(arm);
await typeAndSend(page, 'ALPHA first question');
await waitText(page, 'Reply to ALPHA');
await sleep(600);
await typeAndSend(page, 'BRAVO WRITEFILE please create kept.txt');
await waitText(page, 'Tool write_file finished.');
await sleep(1500);
log('kept.txt after turn B:', fs.existsSync(`${WS}/kept.txt`));
log('url:', page.url());
// unrelated composer draft
await page.locator('[data-web-shell-composer-editor] .cm-content').click();
await page.keyboard.type('UNRELATED DRAFT');
log('rows0', await rows(page));
// --- open + cancel
const mark1 = Date.now();
await openEditor(page);
log('editor value on open:', await page.inputValue('textarea[aria-label="Edit message"]'));
await page.fill('textarea[aria-label="Edit message"]', 'CHANGED BUT CANCELLED');
await shot(page, `s1-${arm}-01-editor-open`);
await page.keyboard.press('Escape');
await sleep(500);
log('editor open after Escape:', await page.locator('textarea[aria-label="Edit message"]').count());
log('rows after cancel', await rows(page));
log('composer after cancel:', JSON.stringify(await composerText(page)));
log('session requests during open+cancel:', net.filter((r) => r.t >= mark1 && r.m !== 'GET').map((r) => `${r.m} ${r.u.replace(/[0-9a-f-]{36}/, ':id')}`));
// --- reopen: draft must start from the recorded message, Shift+Enter inserts newline
await openEditor(page);
log('editor value on reopen:', JSON.stringify(await page.inputValue('textarea[aria-label="Edit message"]')));
await page.fill('textarea[aria-label="Edit message"]', 'CHARLIE replaced question');
await page.keyboard.press('Shift+Enter');
await page.keyboard.type('second line');
await sleep(300);
log('after Shift+Enter still editing:', await page.locator('textarea[aria-label="Edit message"]').count(), JSON.stringify(await page.inputValue('textarea[aria-label="Edit message"]')));
const mark2 = Date.now();
await page.keyboard.press('Enter');
await waitText(page, 'Reply to CHARLIE');
await sleep(1500);
log('session requests during send:', net.filter((r) => r.t >= mark2 && !/events|live-state|status$/.test(r.u)).map((r) => `${r.m} ${r.u.replace(/[0-9a-f-]{36}/, ':id')}`));
log('rows after send', await rows(page));
log('assistant', await assistantLines(page));
log('composer after send:', JSON.stringify(await composerText(page)));
log('kept.txt after edit:', fs.existsSync(`${WS}/kept.txt`));
await shot(page, `s1-${arm}-02-after-send`);
// --- reload
const liveRows = await rows(page);
const liveAsst = await assistantLines(page);
await page.reload();
await waitText(page, 'Reply to CHARLIE', 60000);
await sleep(2000);
const reloadRows = await rows(page);
const reloadAsst = await assistantLines(page);
log('rows after reload', reloadRows, 'equal:', JSON.stringify(reloadRows) === JSON.stringify(liveRows));
log('assistant after reload', reloadAsst, 'equal:', JSON.stringify(reloadAsst) === JSON.stringify(liveAsst));
// --- repeated edits
for (const word of ['DELTA', 'ECHO']) {
  await openEditor(page);
  await page.fill('textarea[aria-label="Edit message"]', `${word} edited again`);
  await page.keyboard.press('Enter');
  await waitText(page, `Reply to ${word}`);
  await sleep(1500);
  log(`rows after ${word}`, await rows(page));
}
log('assistant final', await assistantLines(page));
await shot(page, `s1-${arm}-03-repeated-edits`);
await page.reload();
await waitText(page, 'Reply to ECHO', 60000);
await sleep(2000);
log('rows after final reload', await rows(page));
log('assistant after final reload', await assistantLines(page));
log('model main ctx:', modelLog(arm).filter((r) => r.isMain).map((r) => r.ctx.join('>')));
log('composer final:', JSON.stringify(await composerText(page)));
await browser.close();
