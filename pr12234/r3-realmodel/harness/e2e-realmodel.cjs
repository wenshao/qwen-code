// PR #12234 round 3 — real model (qwen3.8-max) behind a real `qwen serve`,
// daemon-served production Web Shell, every turn typed in this tab.
// Oracles need no knowledge of what the model says:
//   (a) live tab vs. a cold replay of the same session at the same moment
//       must agree on entry visibility and on search rows;
//   (b) rows must equal the number of persisted messages containing the
//       needle, computed afterwards from chats/<id>.jsonl (truth.py).
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = process.env.BASE ?? 'http://127.0.0.1:24235';
const TOKEN = 'verify-token-12234';
const WS = process.env.WS;
const OUT = process.env.OUT ?? __dirname + '/out-realmodel';
fs.mkdirSync(OUT, { recursive: true });
const NEEDLES = ['FIG', 'PRE-FIG', 'MID-FIG', 'POST-FIG', 'PLAIN-FIG', 'R3Q'];

const PROMPTS = [
  'R3Q1. Before using any tool, write one short sentence that contains the token PRE-FIG-1. Then call the list_directory tool on the current directory. After the tool result, answer in one sentence that contains the token POST-FIG-1.',
  'R3Q2. Reply with exactly one sentence containing the token PLAIN-FIG-2. Do not use any tools.',
  'R3Q3. First write a sentence containing PRE-FIG-3. Then read README.md with the read_file tool. Then write a sentence containing MID-FIG-3 and call the glob tool with pattern "*.md". Finally answer in one sentence containing POST-FIG-3.',
  'R3Q4. Reply with exactly one sentence containing the token PLAIN-FIG-4. Do not use any tools.',
  'R3Q5. Before using any tool, write one sentence containing PRE-FIG-5, then call read_file on README.md, then answer with one sentence containing POST-FIG-5.',
  'R3Q6. Reply with exactly one sentence containing PLAIN-FIG-6. Do not use any tools.',
  'R3Q7. Reply with exactly one sentence containing PLAIN-FIG-7. Do not use any tools.',
];

const searchButton = (page) => page.getByRole('button', { name: /^Search this conversation$/ });
const dialogOf = (page) => page.locator('[data-conversation-search]');

async function entryVisible(page) {
  const b = searchButton(page);
  return (await b.count()) === 1 && (await b.isVisible());
}
async function waitIdle(page) {
  // idle = no stop button and the submit button present, stable for 3s
  let stable = 0;
  const t0 = Date.now();
  while (stable < 6) {
    const busy = await page.locator('[data-web-shell-composer-stop]').count();
    stable = busy ? 0 : stable + 1;
    if (Date.now() - t0 > 240000) throw new Error('turn did not settle');
    await page.waitForTimeout(500);
  }
}
async function query(page, text) {
  const dialog = dialogOf(page);
  await dialog.locator('input').fill(text);
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-conversation-search] [role=status]');
    return el && !/Searching/.test(el.textContent ?? '');
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
  const rows = (await dialog.getByRole('option').allTextContents()).map((t) => t.replace(/\s+/g, ' ').slice(0, 110));
  return { status: (await dialog.locator('[role=status]').textContent())?.trim(), rows };
}
async function searchAll(page) {
  if (!(await entryVisible(page))) return null;
  await searchButton(page).click();
  const out = {};
  for (const n of NEEDLES) out[n] = await query(page, n);
  await page.keyboard.press('Escape');
  await dialogOf(page).waitFor({ state: 'detached', timeout: 10000 });
  return out;
}
async function openCold(browser, sessionId) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/session/${sessionId}?token=${TOKEN}`);
  await page.locator('[data-web-shell-composer-editor] .cm-content').waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  return { ctx, page };
}

(async () => {
  const created = await fetch(`${BASE}/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: WS, sessionScope: 'thread' }),
  });
  const { sessionId } = await created.json();
  console.log('session', sessionId);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(`${BASE}/session/${sessionId}?token=${TOKEN}`);
  const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
  await editor.waitFor({ timeout: 30000 });
  const steps = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    await editor.click();
    await page.keyboard.insertText(PROMPTS[i]);
    await page.locator('[data-web-shell-composer-submit]').click();
    await page.waitForTimeout(1500);
    await waitIdle(page);
    await page.waitForTimeout(2500);
    const liveVisible = await entryVisible(page);
    const cold = await openCold(browser, sessionId);
    const coldVisible = await entryVisible(cold.page);
    const step = { turn: i + 1, liveVisible, coldVisible };
    if (i + 1 === PROMPTS.length || liveVisible || coldVisible) {
      step.live = await searchAll(page);
      step.cold = await searchAll(cold.page);
    }
    await cold.page.screenshot({ path: `${OUT}/cold-turn-${i + 1}.png` });
    await cold.ctx.close();
    await page.screenshot({ path: `${OUT}/live-turn-${i + 1}.png` });
    steps.push(step);
    console.log(JSON.stringify({ turn: step.turn, liveVisible, coldVisible, liveRows: step.live && Object.fromEntries(Object.entries(step.live).map(([k, v]) => [k, v.rows.length])), coldRows: step.cold && Object.fromEntries(Object.entries(step.cold).map(([k, v]) => [k, v.rows.length])) }));
    fs.writeFileSync(`${OUT}/steps.json`, JSON.stringify({ sessionId, steps, errors }, null, 1));
  }
  // Second client posts a USER message while this tab has the dialog open.
  await searchButton(page).click();
  await query(page, 'FOREIGN-FIG');
  const loaded = await (await fetch(`${BASE}/session/${sessionId}/load`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' })).json().catch(() => ({}));
  const post = await fetch(`${BASE}/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(loaded.clientId ? { 'x-qwen-client-id': loaded.clientId } : {}) },
    body: JSON.stringify({ prompt: [{ type: 'text', text: 'R3Q8 FOREIGN-FIG-USER. Reply with only the word OK.' }] }),
  });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape');
  await waitIdle(page);
  await page.waitForTimeout(3000);
  await searchButton(page).click();
  const foreignLive = await query(page, 'FOREIGN-FIG');
  await page.screenshot({ path: `${OUT}/foreign-user-live.png` });
  await page.keyboard.press('Escape');
  await page.reload();
  await editor.waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  await searchButton(page).click();
  const foreignReload = await query(page, 'FOREIGN-FIG');
  await page.keyboard.press('Escape');
  const finalReload = await searchAll(page);
  const result = { sessionId, steps, foreign: { prompt: post.status, clientId: loaded.clientId, live: foreignLive, reload: foreignReload }, finalReload, errors };
  fs.writeFileSync(`${OUT}/steps.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result.foreign));
  await browser.close();
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
