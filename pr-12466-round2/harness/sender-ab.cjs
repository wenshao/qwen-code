// Sender tab, opened WHILE the prompt runs: identity during the run, after settle,
// selected check mark, history read, reload restore. Real daemon, no page.route.
const { launch, openSession } = require('./lib.cjs');
(async () => {
  const [base, sid, out, label] = process.argv.slice(2);
  const { browser, page, wire, errors } = await launch({});
  await openSession(page, base, sid);
  const panel = page.getByRole('region', { name: 'Tool calls' });
  const persisted = () => page.evaluate(() => { const v = JSON.parse(localStorage.getItem('qwen-code-web-shell-right-panel-state') || '{}'); return Object.values(v).flatMap(x => (x && x.tabs) || []).filter(t => t.kind === 'turn_calls').map(t => ({ recordId: t.recordId?.slice(0, 8), promptId: t.promptId?.slice(0, 8), hasPromptLabel: 'promptLabel' in t })); });
  const rows = () => panel.locator('[data-web-shell-turn-calls] > li').count();
  const selectedOption = async () => { await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(400); const s = await page.locator('[role=option][aria-selected=true]').allInnerTexts(); const all = await page.getByRole('option').allInnerTexts(); await page.keyboard.press('Escape'); return { selected: s, options: all.length }; };
  await page.locator('[data-web-shell-composer-editor] .cm-content').click(); await page.keyboard.type(label); await page.locator('[data-web-shell-composer-submit]').click();
  await page.getByText(label).last().waitFor(); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'View tool calls' }).last().click(); await panel.waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  const during = { persisted: await persisted(), rows: await rows(), ...(await selectedOption()) };
  await page.screenshot({ path: out.replace('.png', '-running.png'), clip: { x: 1060, y: 0, width: 500, height: 420 } });
  await page.waitForTimeout(14000);
  const after = { persisted: await persisted(), rows: await rows(), reads: wire.filter(w => w.path === '/tool-calls').map(w => w.status), ...(await selectedOption()) };
  await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(400);
  await page.screenshot({ path: out, clip: { x: 1060, y: 0, width: 500, height: 420 } });
  await page.keyboard.press('Escape');
  await page.reload(); await page.locator('[data-web-shell-root]:not([data-web-shell-gate])').waitFor({ state: 'visible', timeout: 60000 }); await page.waitForTimeout(4000);
  const reload = { panel: await panel.isVisible(), rows: (await panel.isVisible()) ? await rows() : 0 };
  console.log(JSON.stringify({ during, after, reload, errors }));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
