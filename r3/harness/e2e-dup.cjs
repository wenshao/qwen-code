// Characterise the duplicate-row finding on a REAL daemon.
const { chromium } = require('playwright');
const fs = require('node:fs');
const SHORT = require('./seed-short.json').sessionId;
const BASE = 'http://127.0.0.1:14234';
const TOKEN = 'verify-token-12234';
const SHOTS = __dirname + '/shots';
const out = [];
const note = (id, name, detail) => { out.push({ id, name, detail }); console.log(id, name, JSON.stringify(detail)); };
const searchButton = (page) => page.getByRole('button', { name: /^Search this conversation$/ });
async function query(page, text) {
  const dialog = page.locator('[data-conversation-search]');
  await dialog.locator('input').fill(text);
  await page.waitForTimeout(400);
  await page.waitForFunction(() => { const el = document.querySelector('[data-conversation-search] [role=status]'); return el && !/Searching/.test(el.textContent ?? ''); }, undefined, { timeout: 60000 });
  await page.waitForTimeout(300);
  return { status: (await dialog.locator('[role=status]').textContent())?.trim(), rows: (await dialog.getByRole('option').allTextContents()).map((t) => t.replace(/\s+/g, ' ').slice(0, 70)) };
}
async function send(page, text, waitFor) {
  const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
  await editor.click();
  await page.keyboard.type(text);
  await page.locator('[data-web-shell-composer-submit]').click();
  await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/\/(turn-index|transcript)$/.test(u.pathname)) wire.push(Object.fromEntries(u.searchParams)); });
  await page.goto(`${BASE}/session/${SHORT}?token=${TOKEN}`);
  await page.getByText('Answer #9:', { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);

  // D1: everything replayed from disk -> no duplicates expected
  await searchButton(page).click();
  let r = await query(page, 'Question #');
  note('D1', 'fresh load (all blocks replayed from disk): rows for "Question #"', { rows: r.rows.length, status: r.status });
  const replayedRows = r.rows.length;
  await page.keyboard.press('Escape');

  // D2: two turns typed in this tab
  await send(page, 'Question #10: tell me about topic-10', 'Answer #10:');
  await send(page, 'Question #11: tell me about topic-11', 'Answer #11:');
  await searchButton(page).click();
  r = await query(page, 'Question #');
  const counts = {};
  for (const row of r.rows) counts[row] = (counts[row] ?? 0) + 1;
  const dups = Object.entries(counts).filter(([, n]) => n > 1).map(([k, n]) => `${n}x ${k}`);
  note('D2', 'after 2 turns typed in this tab: rows for "Question #"', { rows: r.rows.length, expected: replayedRows + 2, status: r.status, duplicated: dups });
  await page.screenshot({ path: `${SHOTS}/r3-dup-rows-${process.env.ARM ?? 'x'}.png` });

  // D3: what does each twin row do?
  r = await query(page, 'topic-11');
  note('D3', 'rows for "topic-11"', r);
  const dialog = page.locator('[data-conversation-search]');
  const twinCount = r.rows.length;
  for (const index of [0, 1]) {
    if (index >= twinCount) break;
    if (index === 1) { await searchButton(page).click(); await query(page, 'topic-11'); }
    const before = wire.length;
    await dialog.getByRole('option').nth(index).click();
    await dialog.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const stillOpen = await dialog.count();
    const alert = stillOpen ? await dialog.locator('[role=alert]').allTextContents() : [];
    note(`D3-row${index}`, 'click result', {
      dialogClosed: stillOpen === 0,
      alert,
      transcriptRequests: wire.length - before,
      historicalViewport: await page.locator('[data-history-viewport="historical"]').count(),
      flash: (await page.locator('[class*="flash"]').first().textContent().catch(() => null))?.slice(0, 60) ?? null,
    });
    if (stillOpen) { await page.screenshot({ path: `${SHOTS}/r2-19-duplicate-row-click-${index}.png` }); await page.keyboard.press('Escape'); }
  }

  // D4: reload -> blocks replayed with record ids -> duplicates gone
  await page.reload();
  await page.getByText('Answer #11:', { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await searchButton(page).click();
  r = await query(page, 'Question #');
  note('D4', 'after reload: rows for "Question #"', { rows: r.rows.length, expected: replayedRows + 2, status: r.status });
  await browser.close();
  fs.writeFileSync(__dirname + `/results-dup-${process.env.ARM ?? 'x'}.json`, JSON.stringify(out, null, 1));
})().catch((e) => { console.error('HARNESS ERROR', e); fs.writeFileSync(__dirname + '/results-dup-partial.json', JSON.stringify(out, null, 1)); process.exit(2); });
