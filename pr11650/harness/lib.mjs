import { chromium } from '<RIG>/wt-after/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
export const S = '<RIG>';
export const PORTS = { after: { model: 18650, daemon: 18660, proxy: 18670 }, before: { model: 18651, daemon: 18661, proxy: 18671 }, main: { model: 18652, daemon: 18662, proxy: 18672 }, beforehost: { model: 18653, daemon: 18663, proxy: 18673 } };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function open(arm, { slowSnapshots = 0 } = {}) {
  for (const k of Object.keys(process.env)) if (/_proxy$/i.test(k)) delete process.env[k];
  const browser = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => { if (/\/session\//.test(r.url())) net.push({ t: Date.now(), m: r.method(), u: new URL(r.url()).pathname }); });
  page.on('console', (m) => { if (m.type() === 'error') fs.appendFileSync(`${S}/logs/${arm}/console.log`, m.text() + '\n'); });
  await page.goto(`http://127.0.0.1:${PORTS[arm].proxy}/?language=en`);
  await page.waitForSelector('[data-web-shell-composer-editor] .cm-content', { timeout: 60000 });
  return { browser, ctx, page, net };
}

export async function typeAndSend(page, text) {
  const ed = page.locator('[data-web-shell-composer-editor] .cm-content');
  await ed.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

export async function waitIdle(page, timeout = 30000) {
  // idle = composer submit present & no stop button
  const t0 = Date.now();
  await sleep(400);
  while (Date.now() - t0 < timeout) {
    const busy = await page.evaluate(() => !!document.querySelector('[data-web-shell-composer-stop], button[aria-label="Stop"], button[aria-label="Stop generating"]'));
    if (!busy) return;
    await sleep(200);
  }
  throw new Error('not idle');
}

export async function waitText(page, text, timeout = 30000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });
}

export async function userRows(page) {
  return page.$$eval('[data-web-shell-user-row]', (rows) => rows.map((r) => ({
    text: (r.querySelector('[data-web-shell-user-bubble]')?.innerText ?? '').trim(),
    images: r.querySelectorAll('[data-web-shell-user-images] img').length,
    files: [...r.querySelectorAll('[data-web-shell-user-files] > *')].map((f) => f.innerText.trim()),
    failed: !!r.querySelector('button[aria-label="Retry sending message"]'),
    editBtn: !!r.parentElement?.closest('*')?.querySelector?.('button[aria-label="Edit message"]'),
  })));
}

export async function transcriptText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-web-shell-transcript], main') ?? document.body;
    return el.innerText;
  });
}

export function modelLog(arm) {
  const f = `${S}/logs/${arm}/model.jsonl`;
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}
export function proxyLog(arm) {
  const f = `${S}/logs/${arm}/proxy.jsonl`;
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

export function lastUserChatRow(page) {
  return page.locator('[class*="chatRow"]').filter({ has: page.locator('[data-web-shell-user-row]') }).last();
}
export async function openEditor(page) {
  const row = lastUserChatRow(page);
  await row.hover();
  await row.locator('button[aria-label="Edit message"]').click();
  await page.waitForSelector('textarea[aria-label="Edit message"]');
}
export async function composerText(page) {
  return page.locator('[data-web-shell-composer-editor] .cm-content').innerText();
}
export async function rows(page) {
  return page.$$eval('[data-web-shell-user-row]', (rs) => rs.map((r) => {
    const b = r.querySelector('[data-web-shell-user-bubble]');
    const txt = (b?.innerText ?? '').trim();
    const imgs = r.querySelectorAll('[data-web-shell-user-images] img').length;
    const files = r.querySelectorAll('[data-web-shell-user-files] > *').length;
    const failed = !!r.querySelector('button[aria-label="Retry sending message"]');
    return `${txt}${imgs ? ` [img×${imgs}]` : ''}${files ? ` [file×${files}]` : ''}${failed ? ' [FAILED+retry]' : ''}`;
  }));
}
export async function assistantLines(page) {
  return page.evaluate(() => (document.body.innerText.match(/(Reply to [^\n]+|NOTIF-REPLY[^\n]+|Tool \w+ finished\.|Background job started\.)/g) ?? []));
}
export async function shot(page, name) {
  await page.mouse.move(5, 5);
  await sleep(250);
  await page.screenshot({ path: `${S}/shots/${name}.png`, clip: { x: 262, y: 0, width: 1018, height: 860 } });
}
export function mkLog(name) {
  const f = `${S}/logs/${name}.txt`;
  fs.writeFileSync(f, '');
  return (...a) => { const l = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(l); fs.appendFileSync(f, l + '\n'); };
}
