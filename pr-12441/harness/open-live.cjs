// Open the persisted "Voice chat" session from the sidebar in a real Chromium, record wire + UI outcome.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:41441';
const OUT = process.env.OUT || '/root/verify/pr12441/shots';
const TAG = process.env.TAG;
const TRANSCRIPT = ['What does this project do?', 'Noted — I will remind you to add tests'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wire = []; const consoleLines = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.origin === BASE && !u.pathname.startsWith('/assets')) wire.push({ t: Date.now(), m: r.request().method(), p: decodeURIComponent(u.pathname), s: r.status() }); });
  page.on('console', (m) => consoleLines.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 400) }));
  page.on('pageerror', (e) => consoleLines.push({ t: Date.now(), type: 'pageerror', text: e.message }));
  await page.goto(`${BASE}/?token=pr12441-token`);
  const row = page.getByText('Voice chat', { exact: true }).first();
  await row.waitFor({ timeout: 60000 });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/${TAG}-a-sidebar.png` });
  const clickAt = Date.now();
  await row.click();
  // settle: either the transcript appears or we give it 8 s
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const txt = await page.locator('body').innerText();
    if (TRANSCRIPT.every((s) => txt.includes(s))) break;
    await sleep(250);
  }
  await sleep(1500);
  await page.mouse.move(1350, 880); await sleep(600);
  await page.screenshot({ path: `${OUT}/${TAG}-b-after-click.png` });
  const body = await page.locator('body').innerText();
  const errorLines = body.split('\n').filter((l) => /does not advertise|workspace_mismatch|failed|error|could not|unable/i.test(l)).slice(0, 10);
  const result = {
    tag: TAG,
    url: page.url(),
    transcriptVisible: TRANSCRIPT.map((s) => body.includes(s)),
    errorLines,
    wireAfterClick: wire.filter((w) => w.t >= clickAt).map((w) => `${w.m} ${w.p} -> ${w.s}`),
    consoleAfterClick: consoleLines.filter((c) => c.t >= clickAt && c.type !== 'debug' && c.type !== 'log').map((c) => `[${c.type}] ${c.text}`),
  };
  // Cold restore: reload on whatever URL the open left us on.
  if (/\/session\//.test(page.url())) {
    const reloadAt = Date.now();
    await page.reload();
    const t1 = Date.now();
    while (Date.now() - t1 < 10000) {
      const txt = await page.locator('body').innerText().catch(() => '');
      if (TRANSCRIPT.every((s) => txt.includes(s))) break;
      await sleep(250);
    }
    await sleep(1500);
    await page.mouse.move(1350, 880); await sleep(600);
    await page.screenshot({ path: `${OUT}/${TAG}-c-after-reload.png` });
    const body2 = await page.locator('body').innerText();
    result.reload = {
      url: page.url(),
      transcriptVisible: TRANSCRIPT.map((s) => body2.includes(s)),
      errorLines: body2.split('\n').filter((l) => /does not advertise|workspace_mismatch|failed|error|could not|unable/i.test(l)).slice(0, 10),
      wire: wire.filter((w) => w.t >= reloadAt).filter((w) => !/\/capabilities|\/live\/status/.test(w.p)).map((w) => `${w.m} ${w.p} -> ${w.s}`),
      console: consoleLines.filter((c) => c.t >= reloadAt && (c.type === 'error' || c.type === 'warning' || c.type === 'pageerror')).map((c) => `[${c.type}] ${c.text}`),
    };
  }
  fs.writeFileSync(`${OUT}/${TAG}-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
