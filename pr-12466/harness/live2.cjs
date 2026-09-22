// Focused live checks with unique prompt labels (nonce) so selector matches are exact.
const fs = require('node:fs');
const { launch, openSession } = require('./lib.cjs');
const BASE = process.argv[2]; const SID = process.argv[3]; const N = process.env.NONCE ?? String(Date.now()).slice(-5); const tag = process.env.TAG ?? 'live2';
const log = []; const note = (k, v) => { log.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };
(async () => {
  const { browser, page, wire, errors } = await launch({});
  await openSession(page, BASE, SID);
  const panel = page.getByRole('region', { name: 'Tool calls' });
  const toolCalls = () => wire.filter(w => w.path === '/tool-calls');
  const rows = async () => (await panel.locator('[data-web-shell-turn-calls] > li').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 60));
  const send = async (text) => { await page.locator('[data-web-shell-composer-editor] .cm-content').click(); await page.keyboard.type(text); await page.locator('[data-web-shell-composer-submit]').click(); };
  const options = async () => { await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(400); const o = await page.getByRole('option').allInnerTexts(); await page.keyboard.press('Escape'); await page.waitForTimeout(200); return o; };
  const count = (opts, label) => opts.filter(o => o.includes(label)).length;
  const pick = async (re) => { await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(300); await page.getByRole('option', { name: re }).first().click(); };
  const persisted = () => page.evaluate(() => { try { const v = JSON.parse(localStorage.getItem('qwen-code-web-shell-right-panel-state') || '{}'); return Object.values(v).flatMap(x => (x && x.tabs) || []).filter(t => t.kind === 'turn_calls'); } catch { return 'unreadable'; } });
  // L1: plain live prompt, no injection.
  const A = `SCN:slow — live-A ${N}`;
  await send(A); await page.getByText(A).last().waitFor(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'View tool calls' }).last().click(); await panel.waitFor({ state: 'visible' });
  await page.waitForTimeout(2000);
  note('L1 running options', { entries: count(await options(), `live-A ${N}`), rows: await rows(), persisted: await persisted() });
  await page.waitForTimeout(10000);
  note('L1 settled', { entries: count(await options(), `live-A ${N}`), rows: await rows(), persisted: await persisted(), reqs: toolCalls().length });
  await page.screenshot({ path: `shots/${tag}-L1-settled-options.png` });
  await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/${tag}-L1-dup-options.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(5000);
  note('L1 +5s', { entries: count(await options(), `live-A ${N}`) });
  const r0 = toolCalls().length;
  await panel.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(2500);
  note('L1 after Refresh', { entries: count(await options(), `live-A ${N}`), reqs: toolCalls().slice(r0).map(w => w.search) , persisted: await persisted() });
  const r1 = toolCalls().length;
  await page.reload(); await page.locator('[data-web-shell-root]:not([data-web-shell-gate])').waitFor({ state: 'visible', timeout: 60000 }); await page.waitForTimeout(3500);
  note('L1 after reload', { panelVisible: await panel.isVisible(), reqs: toolCalls().slice(r1).map(w => w.search) });
  if (!(await panel.isVisible())) { await page.getByRole('button', { name: 'View tool calls' }).last().click(); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(1500); }
  note('L1 reopened after reload', { entries: count(await options(), `live-A ${N}`), selected: await panel.getByRole('combobox', { name: 'Prompt' }).innerText(), rows: await rows(), persisted: await persisted() });
  // L2: older prompt selected while a new one runs.
  const C = `SCN:slow — live-C ${N}`;
  await send(C); await page.getByText(C).last().waitFor(); await page.waitForTimeout(800);
  const t1 = Date.now();
  const b2 = toolCalls().length;
  await pick(/SCN:overview/);
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1000); note(`L2 +${((Date.now() - t1) / 1000).toFixed(1)}s overview while C runs`, { n: (await rows()).length, reqs: toolCalls().slice(b2).map(w => w.search.slice(8, 16)) }); }
  const b3 = toolCalls().length;
  await pick(new RegExp(`live-C ${N}`));
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); note(`L2 +${((Date.now() - t1) / 1000).toFixed(1)}s back on C`, { rows: await rows(), reqs: toolCalls().slice(b3).map(w => w.search.slice(8, 16)) }); }
  note('L2 C entries', count(await options(), `live-C ${N}`));
  note('page errors', errors);
  fs.writeFileSync(`shots/${tag}-log.json`, JSON.stringify(log, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
