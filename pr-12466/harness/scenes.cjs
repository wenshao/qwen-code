// Static scenes against a cold head daemon: prompt switching, expansion, filter,
// timing tooltip, reload restore, legacy session. Real daemon, no page.route.
const fs = require('node:fs');
const { launch, openSession } = require('./lib.cjs');
const BASE = process.argv[2]; const SID = process.argv[3]; const LEGACY = process.argv[4];
const theme = process.env.THEME ?? 'dark'; const locale = process.env.LOC ?? 'en-US';
const tag = process.env.TAG ?? `${theme}-${locale}`;
const L = locale.startsWith('zh') ? { open: '查看工具调用', title: '工具调用', prompt: '提示词', filter: '按工具类型筛选' } : { open: 'View tool calls', title: 'Tool calls', prompt: 'Prompt', filter: 'Filter by tool type' };
const log = []; const note = (k, v) => { log.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };
(async () => {
  const { browser, context, page, wire, errors } = await launch({ locale });
  await openSession(page, BASE, SID);
  if (theme === 'light') { const b = page.getByRole('button', { name: /Switch to light theme|切换到浅色/ }); if (await b.count()) await b.first().click(); await page.waitForTimeout(400); }
  const panel = page.getByRole('region', { name: L.title });
  const shotPanel = async (name) => { await page.waitForTimeout(500); const box = await page.locator('aside, [class*=panel]').filter({ has: panel }).last().boundingBox().catch(() => null); await page.screenshot({ path: `shots/${tag}-${name}.png`, ...(box ? { clip: box } : {}) }); };
  const toolCalls = () => wire.filter(w => w.path === '/tool-calls');
  // Entry: wrench beside Copy on the first visible user message.
  await page.getByRole('button', { name: L.open }).first().click();
  await panel.waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  const selectPrompt = async (label) => {
    const before = toolCalls().length;
    await panel.getByRole('combobox', { name: L.prompt }).click();
    await page.getByRole('option', { name: label }).first().click();
    await page.waitForTimeout(2000);
    const count = await panel.locator('[data-web-shell-turn-calls] > li').count();
    const summary = await panel.innerText();
    return { requests: toolCalls().slice(before), rows: count, countText: /\d+ tool calls|共 \d+ 次工具调用/.exec(summary)?.[0] };
  };
  const opts = await (async () => { await panel.getByRole('combobox', { name: L.prompt }).click(); await page.waitForTimeout(400); const o = await page.getByRole('option').allInnerTexts(); await page.keyboard.press('Escape'); return o; })();
  note('prompt options', opts);
  note('select overview', await selectPrompt(/SCN:overview/));
  await page.screenshot({ path: `shots/${tag}-full-overview.png` });
  const rowTexts = await panel.locator('[data-web-shell-turn-calls] > li').allInnerTexts();
  note('overview rows', rowTexts.map(t => t.replace(/\s+/g, ' ').slice(0, 110)));
  const row = (text) => panel.locator('[data-web-shell-turn-calls] > li').filter({ hasText: text }).first();
  // Timing tooltip on the MCP row.
  const mcp = row('lookup_sku').or(row('inventory')).first();
  await row('List source files').locator('[aria-label^="Elapsed"], [aria-label^="耗时"]').first().hover();
  await page.waitForTimeout(900);
  note('shell tooltip', await page.locator('[role=tooltip]').allInnerTexts());
  await page.screenshot({ path: `shots/${tag}-tooltip.png` });
  await page.mouse.move(5, 5); await page.waitForTimeout(300);
  // Expand shell row: Arguments / Result / Other.
  await row('List source files').locator('button[aria-expanded]').first().click();
  await page.waitForTimeout(600);
  note('shell expanded', (await row('List source files').innerText()).replace(/\s+/g, ' ').slice(0, 400));
  await shotPanel('shell-expanded');
  await row('List source files').locator('button[aria-expanded]').first().click();
  // Expand edit row (diff).
  const edit = panel.locator('[data-web-shell-turn-calls] > li').nth(2);
  await edit.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(600);
  note('edit expanded', (await edit.innerText()).replace(/\s+/g, ' ').slice(0, 300));
  await shotPanel('edit-expanded');
  await edit.locator('button[aria-expanded]').first().click();
  // Filter to MCP and expand the wrapped MCP call.
  await panel.getByRole('combobox', { name: L.filter }).click(); await page.waitForTimeout(300);
  note('filter options', await page.getByRole('option').allInnerTexts());
  await page.getByRole('option', { name: 'MCP', exact: true }).click(); await page.waitForTimeout(500);
  const mrows = panel.locator('[data-web-shell-turn-calls] > li');
  note('mcp filter', { rows: await mrows.count(), text: (await panel.innerText()).match(/\d+ tool calls|共 \d+ 次工具调用/)?.[0], names: (await mrows.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 90)) });
  await mrows.first().locator('button[aria-expanded]').first().click(); await page.waitForTimeout(600);
  note('mcp expanded', (await mrows.first().innerText()).replace(/\s+/g, ' ').slice(0, 500));
  await shotPanel('mcp-expanded');
  await panel.getByRole('combobox', { name: L.filter }).click(); await page.waitForTimeout(300);
  await page.getByRole('option').first().click(); await page.waitForTimeout(300);
  // Other turns.
  for (const [name, re] of [['bulk', /SCN:bulk —/], ['bulkcap', /SCN:bulkcap/], ['approve', /SCN:approve/], ['cancel60s', /SCN:cancel —/]]) {
    const r = await selectPrompt(re);
    const statuses = (await panel.locator('[data-web-shell-turn-calls] > li').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 80));
    note(`select ${name}`, { ...r, sample: statuses.slice(0, 2), failed: statuses.filter(s => /Failed|失败/.test(s)).length });
    if (name === 'bulkcap') await shotPanel('bulkcap');
  }
  // The two cancel2 turns share a label: choose each by position.
  await panel.getByRole('combobox', { name: L.prompt }).click(); await page.waitForTimeout(300);
  const c2 = page.getByRole('option', { name: /SCN:cancel2/ });
  note('cancel2 options', await c2.count());
  await c2.last().click(); await page.waitForTimeout(2000);
  note('cancelled turn', (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 300));
  await shotPanel('cancelled');
  // Reload: panel + selected prompt restore.
  const before = toolCalls().length;
  await page.reload();
  await page.locator('[data-web-shell-root]:not([data-web-shell-gate])').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3500);
  note('after reload', { panelVisible: await panel.isVisible(), selected: await panel.getByRole('combobox', { name: L.prompt }).innerText().catch(() => null), requests: toolCalls().slice(before) });
  // Refresh button: exactly one more read for a historical prompt.
  const b2 = toolCalls().length;
  await panel.getByRole('button', { name: /Refresh|刷新/ }).click(); await page.waitForTimeout(2000);
  note('refresh', toolCalls().slice(b2));
  if (LEGACY) {
    const b3 = toolCalls().length;
    await openSession(page, BASE, LEGACY);
    await page.waitForTimeout(1000);
    if (!(await panel.isVisible())) { await page.getByRole('button', { name: L.open }).first().click(); }
    await page.waitForTimeout(1200);
    const r = await selectPrompt(/SCN:overview/);
    const legacyRow = panel.locator('[data-web-shell-turn-calls] > li').first();
    const el = legacyRow.locator('[aria-label^="Elapsed"], [aria-label^="耗时"]').first();
    await el.hover(); await page.waitForTimeout(900);
    note('legacy overview', { ...r, rows: (await panel.locator('[data-web-shell-turn-calls] > li').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 70)), tooltip: await page.locator('[role=tooltip]').allInnerTexts(), ariaDescription: await legacyRow.locator('button[aria-expanded]').first().getAttribute('aria-description') });
    await page.screenshot({ path: `shots/${tag}-legacy-hover.png` });
  }
  note('all tool-calls requests', toolCalls());
  note('page errors', errors);
  fs.writeFileSync(`shots/${tag}-log.json`, JSON.stringify(log, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
