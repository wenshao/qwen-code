// Live scenes: a real ~8 s prompt submitted from the composer of the real Web Shell.
const fs = require('node:fs');
const { launch, openSession } = require('./lib.cjs');
const BASE = process.argv[2]; const SID = process.argv[3]; const tag = process.env.TAG ?? 'live';
const log = []; const note = (k, v) => { log.push({ k, v, t: Date.now() }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };
(async () => {
  const { browser, page, wire, errors } = await launch({});
  await openSession(page, BASE, SID);
  const panel = page.getByRole('region', { name: 'Tool calls' });
  const toolCalls = () => wire.filter(w => w.path === '/tool-calls');
  const rows = async () => (await panel.locator('[data-web-shell-turn-calls] > li').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 90));
  const send = async (text) => {
    await page.locator('[data-web-shell-composer-editor] .cm-content').click();
    await page.keyboard.type(text);
    await page.locator('[data-web-shell-composer-submit]').click();
  };
  // Run 1: open the panel on the running prompt, inject a mid-turn message.
  await send('SCN:slow — run the slow scenario');
  const t0 = Date.now();
  await page.getByText('SCN:slow — run the slow scenario').last().waitFor();
  await page.waitForTimeout(700);
  const btns = page.getByRole('button', { name: 'View tool calls' });
  await btns.last().click();
  await panel.waitFor({ state: 'visible' });
  const before = toolCalls().length;
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1000); note(`run1 +${((Date.now() - t0) / 1000).toFixed(1)}s`, await rows()); if (i === 2) await page.screenshot({ path: `shots/${tag}-running.png` }); }
  await send('Also mention util.js in the summary.');
  note('mid-turn injected at', ((Date.now() - t0) / 1000).toFixed(1));
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(1000); note(`run1 +${((Date.now() - t0) / 1000).toFixed(1)}s`, { rows: await rows(), reqs: toolCalls().length - before }); }
  await page.waitForTimeout(2000);
  note('run1 settled', { rows: await rows(), requestsSinceOpen: toolCalls().slice(before) });
  const el = panel.locator('[data-web-shell-turn-calls] > li').first().locator('[aria-label^="Elapsed"]').first();
  await el.hover(); await page.waitForTimeout(900);
  note('run1 tooltip', await page.locator('[role=tooltip]').allInnerTexts());
  await page.screenshot({ path: `shots/${tag}-settled.png` });
  await page.mouse.move(5, 5);
  await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(400);
  note('prompt options after run1', await page.getByRole('option').allInnerTexts());
  await page.keyboard.press('Escape');
  const dump = async () => page.evaluate(() => Object.keys(localStorage).filter(k => (localStorage.getItem(k) || '').includes('turn_calls')).map(k => { const v = JSON.parse(localStorage.getItem(k)); return { k, tabs: Object.values(v).flatMap(x => (x && x.tabs) || []).filter(t => t.kind === 'turn_calls') }; }));
  note('persisted turn_calls tabs (run1 settled)', await dump());
  const b1 = toolCalls().length;
  await page.reload();
  await page.locator('[data-web-shell-root]:not([data-web-shell-gate])').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3500);
  note('run1 after reload', { panelVisible: await panel.isVisible(), selected: await panel.getByRole('combobox', { name: 'Prompt' }).innerText().catch(() => null), rows: await panel.isVisible() ? await rows() : null, requests: toolCalls().slice(b1) });
  await page.screenshot({ path: `shots/${tag}-after-reload.png` });
  if (!(await panel.isVisible())) { await page.getByRole('button', { name: 'View tool calls' }).last().click(); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(1500); }
  // Run 2: while a new prompt runs, look at an older prompt.
  await send('SCN:slow — run the slow scenario again');
  const t1 = Date.now();
  await page.waitForTimeout(1500);
  const b2 = toolCalls().length;
  await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(300);
  await page.getByRole('option', { name: /SCN:overview/ }).first().click();
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1000); note(`run2 +${((Date.now() - t1) / 1000).toFixed(1)}s viewing overview`, { rowsN: (await rows()).length, reqs: toolCalls().slice(b2).map(w => w.search.slice(8, 16)) }); }
  // Switch back to the running prompt: live rows, no history read while it runs.
  const b3 = toolCalls().length;
  await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(300);
  await page.getByRole('option', { name: /run the slow scenario again/ }).first().click();
  for (let i = 0; i < 9; i++) { await page.waitForTimeout(1000); note(`run2 +${((Date.now() - t1) / 1000).toFixed(1)}s viewing running`, { rows: await rows(), reqs: toolCalls().length - b3 }); }
  await page.waitForTimeout(2500);
  note('run2 settled', { rows: await rows(), requests: toolCalls().slice(b3) });
  note('all tool-calls requests', toolCalls());
  note('page errors', errors);
  fs.writeFileSync(`shots/${tag}-log.json`, JSON.stringify(log, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
