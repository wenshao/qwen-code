// PR #12234 — probes that a mock daemon cannot answer:
//  P1  messages STREAMED LIVE into this tab (not replayed from disk) vs. their
//      persisted twins: does the dialog list the same message twice?
//  P2  a real tool-call turn: assistant text before and after the tool call.
//  P3  another client appends a turn while the dialog is open.
const { chromium } = require('playwright');
const fs = require('node:fs');
const SHORT = require('./seed-short.json').sessionId;
const BASE = 'http://127.0.0.1:14234';
const TOKEN = 'verify-token-12234';
const SHOTS = __dirname + '/shots';
const results = [];
const check = (id, name, pass, detail) => { results.push({ id, name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`); };
const searchButton = (page) => page.getByRole('button', { name: /^Search this conversation$/ });

async function query(page, text) {
  const dialog = page.locator('[data-conversation-search]');
  await dialog.locator('input').fill(text);
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-conversation-search] [role=status]');
    return el && !/Searching/.test(el.textContent ?? '');
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(300);
  return {
    status: (await dialog.locator('[role=status]').textContent())?.trim(),
    rows: (await dialog.getByRole('option').allTextContents()).map((t) => t.replace(/\s+/g, ' ').slice(0, 90)),
  };
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/session/${SHORT}?token=${TOKEN}`);
  await page.getByText('Answer #6:', { exact: false }).first().waitFor({ timeout: 30000 });

  // P1: a turn produced live in THIS tab
  await send(page, 'Question #7: tell me about topic-7 LIVE-TWIN-PROBE', 'Answer #7:');
  await searchButton(page).click();
  let r = await query(page, 'LIVE-TWIN-PROBE');
  check('P1a', 'live-streamed USER message appears exactly once', r.rows.length === 1, r);
  r = await query(page, 'Answer #7');
  check('P1b', 'live-streamed ASSISTANT message appears exactly once', r.rows.length === 1, r);
  r = await query(page, 'common-token');
  check('P1c', 'all 7 assistant answers listed once each (6 replayed + 1 live)', r.rows.length === 7, r);
  await page.screenshot({ path: `${SHOTS}/r2-15-live-twin-once.png` });
  await page.keyboard.press('Escape');

  // P2: real tool call
  await send(page, 'Question #8: TOOLCALL please inspect the workspace', 'POST-TOOL-NEEDLE-ORCHID');
  await searchButton(page).click();
  const pre = await query(page, 'pre-tool-needle-orchid');
  check('P2a', 'assistant text BEFORE the tool call is searchable (1 row)', pre.rows.length === 1, pre);
  const post = await query(page, 'post-tool-needle-orchid');
  check('P2b', 'assistant text AFTER the tool call is searchable (1 row)', post.rows.length === 1, post);
  const both = await query(page, 'NEEDLE-ORCHID');
  check('P2c', 'a needle present on both sides of the tool call', both.rows.length >= 1, both);
  await page.screenshot({ path: `${SHOTS}/r2-16-tool-call-turn.png` });
  await page.locator('[data-conversation-search]').getByRole('option').last().click();
  await page.locator('[data-conversation-search]').waitFor({ state: 'detached', timeout: 30000 });
  await page.locator('[class*="flash"]').first().waitFor({ timeout: 15000 });
  const flashed = (await page.locator('[class*="flash"]').first().textContent())?.replace(/\s+/g, ' ').slice(0, 120);
  check('P2d', 'selecting the tool-turn hit flashes an ORCHID message', /NEEDLE-ORCHID/.test(flashed ?? ''), { flashed });

  // P3: a different client appends a turn while the dialog is open
  await searchButton(page).click();
  r = await query(page, 'common-token');
  const beforeRows = r.rows.length;
  const created = await fetch(`${BASE}/session/${SHORT}/load`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' });
  const loaded = await created.json().catch(() => ({}));
  const clientId = loaded.clientId;
  const post2 = await fetch(`${BASE}/session/${SHORT}/prompt`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(clientId ? { 'x-qwen-client-id': clientId } : {}) },
    body: JSON.stringify({ prompt: [{ type: 'text', text: 'Question #9: tell me about topic-9 from another client' }] }),
  });
  check('P3a', 'second client accepted by the daemon', post2.status === 202 || post2.status === 200, { load: created.status, prompt: post2.status, clientId });
  await page.waitForTimeout(5000);
  const dialog = page.locator('[data-conversation-search]');
  const afterRows = (await dialog.getByRole('option').allTextContents()).map((t) => t.replace(/\s+/g, ' ').slice(0, 60));
  const n9 = afterRows.filter((t) => /Answer #9/.test(t)).length;
  check('P3b', 'dialog stays open and picks up the foreign turn exactly once', (await dialog.count()) === 1 && n9 === 1 && afterRows.length === beforeRows + 1, { beforeRows, afterRows: afterRows.length, n9 });
  await page.screenshot({ path: `${SHOTS}/r2-17-foreign-turn-while-open.png` });
  check('E3', 'no uncaught page errors', errors.length === 0, errors);
  await browser.close();
  fs.writeFileSync(__dirname + '/results-live.json', JSON.stringify(results, null, 1));
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch((e) => { console.error('HARNESS ERROR', e); fs.writeFileSync(__dirname + '/results-live-partial.json', JSON.stringify(results, null, 1)); process.exit(2); });
