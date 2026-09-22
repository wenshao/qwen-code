// Is the missing identity a click-timing race, or does the sender's live block never get one?
// Page A sends; page B (a second client on the same session) only watches.
const { launch, openSession } = require('./lib.cjs');
const BASE = process.argv[2]; const SID = process.argv[3]; const N = String(Date.now()).slice(-5);
(async () => {
  const a = await launch({}); const b = await launch({});
  await openSession(a.page, BASE, SID); await openSession(b.page, BASE, SID);
  const persisted = (page) => page.evaluate(() => { const v = JSON.parse(localStorage.getItem('qwen-code-web-shell-right-panel-state') || '{}'); return Object.values(v).flatMap(x => (x && x.tabs) || []).filter(t => t.kind === 'turn_calls').map(t => ({ turnId: t.turnId, recordId: t.recordId?.slice(0, 8), promptId: t.promptId?.slice(0, 8) })); });
  const entries = async (page, label) => { const p = page.getByRole('region', { name: 'Tool calls' }); await p.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(400); const o = await page.getByRole('option').allInnerTexts(); await page.keyboard.press('Escape'); return o.filter(x => x.includes(label)).length; };
  const text = `SCN:slow — live-D ${N}`;
  await a.page.locator('[data-web-shell-composer-editor] .cm-content').click(); await a.page.keyboard.type(text); await a.page.locator('[data-web-shell-composer-submit]').click();
  a.t0 = b.t0 = Date.now(); a.wire.length = 0; b.wire.length = 0;
  await a.page.getByText(text).last().waitFor(); await b.page.getByText(text).last().waitFor({ timeout: 20000 });
  await a.page.waitForTimeout(4000);
  for (const [name, x] of [['sender', a], ['observer', b]]) {
    await x.page.getByRole('button', { name: 'View tool calls' }).last().click();
    await x.page.getByRole('region', { name: 'Tool calls' }).waitFor({ state: 'visible' }); await x.page.waitForTimeout(800);
    console.log(name, 'opened +4s (running)', JSON.stringify({ persisted: await persisted(x.page), entries: await entries(x.page, `live-D ${N}`) }));
  }
  await a.page.waitForTimeout(8000);
  for (const [name, x] of [['sender', a], ['observer', b]]) console.log(name, 'settled', JSON.stringify({ persisted: await persisted(x.page), entries: await entries(x.page, `live-D ${N}`), toolCallsReads: x.wire.filter(w => w.path === '/tool-calls').map(w => ({ dt: w.t - (x.t0 ?? 0), turn: w.search.slice(8, 16), status: w.status })), turnIndexReads: x.wire.filter(w => w.path === '/turn-index').length }));
  await a.browser.close(); await b.browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
