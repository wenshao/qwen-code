// Before arm: (1) served Web Shell has no edit entry; (2) with host editing
// enabled (as VS Code companion does), clicking Edit rewinds immediately and
// overwrites the composer draft.
import { open, typeAndSend, waitText, sleep, rows, assistantLines, shot, mkLog, composerText, lastUserChatRow } from './lib.mjs';
const log = mkLog('sB');
{
  const { browser, page } = await open('before');
  await typeAndSend(page, 'ALPHA first question');
  await waitText(page, 'Reply to ALPHA');
  await sleep(800);
  await typeAndSend(page, 'BRAVO second question');
  await waitText(page, 'Reply to BRAVO');
  await sleep(1500);
  await lastUserChatRow(page).hover();
  await sleep(300);
  log('[before, served] edit buttons on page:', await page.locator('button[aria-label="Edit message"]').count());
  await page.screenshot({ path: `${(await import('./lib.mjs')).S}/shots/sB-0-before-served-hover.png`, clip: { x: 262, y: 0, width: 1018, height: 860 } });
  await browser.close();
}
{
  const arm = 'beforehost';
  const { browser, page, net } = await open(arm);
  await typeAndSend(page, 'ALPHA first question');
  await waitText(page, 'Reply to ALPHA');
  await sleep(800);
  await typeAndSend(page, 'BRAVO second question');
  await waitText(page, 'Reply to BRAVO');
  await sleep(1500);
  await page.locator('[data-web-shell-composer-editor] .cm-content').click();
  await page.keyboard.type('UNRELATED DRAFT');
  log('[before+host editing] rows before click', await rows(page));
  const row = page.locator('[data-web-shell-user-row]').last();
  await row.hover();
  const t0 = Date.now();
  await row.locator('button[aria-label="Edit message"]').click({ force: true });
  await sleep(1500);
  log('[before+host editing] requests on click (no confirmation yet):', net.filter((r) => r.t >= t0 && /rewind/.test(r.u)).map((r) => `${r.m} ${r.u.replace(/[0-9a-f-]{36}/, ':id')}`));
  log('[before+host editing] rows 1.5s after click', await rows(page));
  log('[before+host editing] assistant', await assistantLines(page));
  log('[before+host editing] composer after click', JSON.stringify(await composerText(page)));
  await shot(page, 'sB-1-beforehost-after-click');
  await page.keyboard.press('Escape');
  await sleep(500);
  await page.reload();
  await waitText(page, 'Reply to ALPHA', 60000);
  await sleep(2500);
  log('[before+host editing] rows after Escape + reload (user never sent anything)', await rows(page));
  log('[before+host editing] composer after reload', JSON.stringify(await composerText(page)));
  await browser.close();
}
