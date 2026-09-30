// b4: how each result state renders; ANSI/CR, CJK page boundaries; hosts without a save picker; other actors.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { chromium, webkit, open, SHOTS, transcript, expandShell, openPanel, waitPage, rig } from './pw.mjs';
L.openLog('b4-states');
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const sess = (name) => s1.find((r) => r.case === name).session;
const browser = await chromium.launch();
const card = async (page) => (await page.locator('[data-managed-tool-result]').allInnerTexts()).map((t) => t.replace(/\n+/g, ' | '));

for (const name of ['ok', 'empty', 'notstarted', 'partial', 'binary']) {
  const { page, context } = await open(browser, sess(name), '&save=opfs');
  await expandShell(page);
  L.say(`card ${name}`, { badges: await card(page), viewOutput: await page.getByRole('button', { name: 'View output' }).count(), transcriptTail: (await transcript(page)).slice(-260) });
  await page.screenshot({ path: `${SHOTS}/b4-card-${name}.png` });
  if (await page.getByRole('button', { name: 'View output' }).count()) {
    await page.getByRole('button', { name: 'View output' }).first().click();
    await page.locator('[role=dialog]').waitFor();
    await page.waitForTimeout(2500);
    L.say(`panel ${name}`, (await page.locator('[role=dialog]').innerText()).replace(/\n+/g, ' | ').slice(0, 420));
    await page.screenshot({ path: `${SHOTS}/b4-panel-${name}.png` });
    if (name === 'empty') {
      await page.locator('[role=dialog]').getByRole('button', { name: /^stderr/ }).click();
      await page.waitForTimeout(1200);
      L.say('panel empty stderr', (await page.locator('[role=dialog] pre[data-managed-output-bytes]').innerText()));
    }
  }
  await context.close();
}
// ANSI / CR
{
  const { page, context } = await open(browser, sess('ansi'), '&save=opfs');
  await expandShell(page);
  await openPanel(page);
  const dialog = await waitPage(page);
  L.say('ansi panel text', JSON.stringify(await dialog.locator('pre[data-managed-output-bytes]').evaluate((el) => el.textContent)));
  L.say('ansi approved preview', JSON.stringify(await dialog.locator('section pre').first().evaluate((el) => el.textContent)));
  await page.screenshot({ path: `${SHOTS}/b4-panel-ansi.png` });
  await context.close();
}
// CJK across page boundaries
{
  const { page, context } = await open(browser, sess('cjk'), '&save=opfs');
  await expandShell(page);
  L.say('cjk card preview tail', JSON.stringify((await page.locator('pre').first().evaluate((el) => el.textContent)).slice(-40)));
  await openPanel(page);
  const dialog = await waitPage(page);
  let joined = '';
  const pages = [];
  for (let i = 0; i < 8; i++) {
    await waitPage(page);
    const text = await dialog.locator('pre[data-managed-output-bytes]').evaluate((el) => el.textContent);
    pages.push({ page: i, chars: text.length, replacement: (text.match(/�/g) ?? []).length });
    joined += text;
    const next = dialog.getByRole('button', { name: 'Next page' });
    if (await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(200);
  }
  let expected = '';
  for (let i = 0; i < 9000; i++) expected += String(i).padStart(5, '0') + ' 构建日志：第' + i + '行，编译模块完成 ✓\n';
  L.say('cjk pages', pages);
  L.say('cjk all pages joined equal the produced text', { equal: joined === expected, joinedChars: joined.length, expectedChars: expected.length });
  const previewTail = await dialog.locator('section pre').first().evaluate((el) => el.textContent.slice(-12));
  L.say('cjk approved preview tail', { tail: JSON.stringify(previewTail), endsWithReplacementChar: previewTail.endsWith('�') });
  await page.screenshot({ path: `${SHOTS}/b4-panel-cjk.png` });
  await context.close();
}
// session-wide Outputs list (4 artifacts from two calls) and session switch
{
  const { page, context } = await open(browser, sess('seq2'), '&save=opfs');
  await page.getByRole('button', { name: 'Outputs' }).click();
  await page.locator('[role=dialog]').waitFor();
  await page.waitForTimeout(2000);
  L.say('session-wide Outputs (two calls)', (await page.locator('[role=dialog] [role=group] button').allInnerTexts()));
  await page.screenshot({ path: `${SHOTS}/b4-panel-session-list.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  L.say('Escape closes the panel', (await page.locator('[role=dialog]').count()) === 0);
  await context.close();
}
// host without showSaveFilePicker
{
  const { page, context } = await open(browser, sess('ok'), '&save=none');
  await expandShell(page);
  await openPanel(page);
  const dialog = await waitPage(page);
  L.say('Chromium with showSaveFilePicker removed', { downloadButton: await dialog.getByRole('button', { name: 'Download' }).count(), note: (await dialog.innerText()).split('\n').filter((l) => /download/i.test(l)) });
  await context.close();
}
try {
  const wk = await webkit.launch();
  const { page, context } = await open(wk, sess('ok'), '');
  await expandShell(page);
  await openPanel(page);
  const dialog = await waitPage(page);
  L.say('WebKit (no File System Access save picker)', { hasPicker: await page.evaluate(() => 'showSaveFilePicker' in window), downloadButton: await dialog.getByRole('button', { name: 'Download' }).count(), pageText: (await dialog.locator('pre[data-managed-output-bytes]').innerText()).trim(), note: (await dialog.innerText()).split('\n').filter((l) => /download/i.test(l)) });
  await page.screenshot({ path: `${SHOTS}/b4-webkit-panel.png` });
  await wk.close();
} catch (e) {
  L.say('WebKit', 'not run: ' + String(e.message).slice(0, 200));
}
// another actor without a Workspace grant, then with a grant (shared preview is visible to every Session reader)
{
  const s = sess('ok');
  const ws = L.one(`SELECT workspace_id FROM managed_agent_session WHERE session_id='${s}'`);
  let { page, context } = await open(browser, s, '&save=opfs&actor=bob');
  await page.waitForTimeout(3000);
  L.say('bob without grant', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
  await context.close();
  L.grant(ws, 'bob', { canCreate: false });
  ({ page, context } = await open(browser, s, '&save=opfs&actor=bob'));
  await expandShell(page);
  await openPanel(page);
  const dialog = await waitPage(page);
  L.say('bob with a read grant', { card: await card(page), bytes: (await dialog.locator('pre[data-managed-output-bytes]').innerText()).trim() });
  L.sql(`DELETE FROM managed_workspace_access WHERE workspace_id='${ws}' AND actor_id='bob'`);
  await dialog.getByRole('button', { name: 'Refresh output' }).click();
  await page.waitForTimeout(2500);
  L.say('bob after the grant is removed, Refresh output', (await page.locator('[role=dialog]').innerText().catch(() => 'dialog closed')).replace(/\n+/g, ' | ').slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/b4-revoked-refresh.png` });
  await context.close();
}
await browser.close();
