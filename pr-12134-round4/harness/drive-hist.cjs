// Historical-viewport interaction (triage stage-2 "not verified"): strip
// resizes while the reader views a paged-out older range via turn navigation.
const { chromium } = require('playwright');
const fs = require('fs');
const ARM = process.env.ARM || 'head';
const BASE = 'http://127.0.0.1:4234', FAKE = 'http://127.0.0.1:18134';
const OUT = `/root/verify/pr12134/results/${ARM}-hist${process.env.EDGE ? '-edge' : ''}`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fake = async (p) => (await fetch(FAKE + p)).json();
const ORD = Number(process.env.ORD || 5);
(async () => {
  await fetch(FAKE + '/control/reset');
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
  const reqs = [];
  page.on('request', (r) => { const u = r.url(); if (/\/session\/[^/]+\/(transcript|turn-index|history|viewport|range|page)/.test(u)) reqs.push({ t: Date.now(), u: u.replace(BASE, '').replace(/\/session\/[^/]+/, '/session/:id') }); });
  await page.goto(BASE + '/');
  const entry = page.getByText('turn 1: short question', { exact: false }).first();
  if (!(await entry.isVisible().catch(() => false))) {
    await page.getByText('Show all', { exact: true }).first().click();
  }
  await entry.click();
  await page.getByText('All seven steps are complete.', { exact: false }).last().waitFor({ timeout: 30000 });
  await sleep(1500);
  const ed = page.locator('[data-web-shell-composer-editor] .cm-content').first();
  await ed.click(); await page.keyboard.type('PLAN steps7');
  await page.locator('[data-web-shell-composer-submit]').first().click();
  const waitWaiting = async () => { for (let i = 0; i < 300; i++) { if ((await fake('/control/state')).waiting >= 1) return; await sleep(100); } throw new Error('no held request'); };
  await waitWaiting();
  await fake('/control/release?n=1');
  await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label="Current tasks"]')].some((s) => s.textContent.includes('Step 1 / 7')));
  await waitWaiting();
  await sleep(800);
  // jump to an early turn with the global turn navigation
  const nav = await page.evaluate((ord) => {
    const all = [...document.querySelectorAll('[data-turn-ordinal]')].map((e) => [Number(e.getAttribute('data-turn-ordinal')), e]).sort((a, b) => a[0] - b[0]);
    const pick = all.find(([o]) => o >= ord) || all[0];
    if (!pick) return { ok: false, ordinals: 0 };
    pick[1].click();
    return { ok: true, ordinal: pick[0], ordinals: all.map(([o]) => o).slice(0, 6) };
  }, ORD);
  await sleep(2500);
  const probe = (tag) => page.evaluate((tag) => {
    const list = document.querySelector('[data-web-shell-message-list]');
    const lr = list.getBoundingClientRect();
    const vp = document.querySelector('[data-history-viewport]');
    const strip = [...document.querySelectorAll('section[aria-label="Current tasks"]')].find((s) => s.parentElement && s.parentElement.querySelector('[data-web-shell-message-list]'));
    // anchor: the text node of a "turn N:" user message inside the viewport
    if (!window.__anchorNode || !window.__anchorNode.isConnected) {
      const w = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
      let n; window.__anchorNode = null;
      while ((n = w.nextNode())) { if (/^turn \d+: short/.test(n.textContent)) { const r = n.parentElement.getBoundingClientRect(); if (r.top > lr.top + 120 && r.top < lr.bottom - 120) { window.__anchorNode = n; break; } } }
    }
    const a = window.__anchorNode;
    const firstVisible = (() => { const w = document.createTreeWalker(list, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (/^turn \d+: short/.test(n.textContent)) { const r = n.parentElement.getBoundingClientRect(); if (r.bottom > lr.top) return n.textContent.slice(0, 9); } } return null; })();
    return { tag, view: vp && vp.getAttribute('data-history-viewport'), anchor: a ? a.textContent.slice(0, 9) : null, anchorY: a ? +a.parentElement.getBoundingClientRect().top.toFixed(2) : null, firstVisible, scrollTop: +list.scrollTop.toFixed(2), fromTop: +list.scrollTop.toFixed(2), fromBottom: +(list.scrollHeight - list.scrollTop - list.clientHeight).toFixed(2), stripH: strip ? +strip.getBoundingClientRect().height.toFixed(2) : 0, loading: !!document.querySelector('[role="status"]') && document.body.innerText.includes('Loading earlier') };
  }, tag);
  // grow the historical range: wheel up so the viewport loads older pages,
  // then park mid-range (>= 250px from both edges)
  const box = await page.locator('[data-web-shell-message-list]').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const geo = () => page.evaluate(() => { const l = document.querySelector('[data-web-shell-message-list]'); return { st: Math.round(l.scrollTop), sh: l.scrollHeight, ch: l.clientHeight, view: document.querySelector('[data-history-viewport]').getAttribute('data-history-viewport') }; });
  for (let i = 0; i < 25; i++) {
    const g = await geo();
    if (g.sh - g.ch > 1400) break;
    await page.mouse.wheel(0, -400);
    await sleep(700);
  }
  let g = await geo();
  console.log('range after growing', JSON.stringify(g));
  // park: wheel down until >= 250px from the top, keeping >= 250px from bottom
  for (let i = 0; i < 20 && g.st < 400; i++) { await page.mouse.wheel(0, 150); await sleep(500); g = await geo(); }
  await sleep(1500);
  if (process.env.EDGE) {
    await page.evaluate((v) => { document.querySelector('[data-web-shell-message-list]').scrollTop = v; }, Number(process.env.EDGE));
    await sleep(2500);
  }
  console.log('parked', JSON.stringify(await geo()), 'history reqs so far', reqs.length);
  const reqsBeforeSteps = reqs.length;
  const rows = [];
  let prev = await probe('historical view');
  rows.push({ ...prev, nav: JSON.stringify(nav), reqs: reqs.length });
  await page.screenshot({ path: `${OUT}/hist-entered.png` });
  const expect = ['Step 2 / 7', 'Step 3 / 7', 'Step 4 / 7', 'Step 5 / 7', 'Step 6 / 7', 'Step 7 / 7', null];
  for (const want of expect) {
    const before = reqs.length;
    await fake('/control/release?n=1');
    await page.waitForFunction((w) => { const s = [...document.querySelectorAll('section[aria-label="Current tasks"]')].find((x) => x.parentElement && x.parentElement.querySelector('[data-web-shell-message-list]')); if (w === null) return !s; return !!s && s.textContent.includes(w); }, want, { timeout: 20000 });
    await sleep(1200);
    const s = await probe(want ?? 'unmount');
    rows.push({ ...s, shift: s.anchorY !== null && prev.anchorY !== null && s.anchor === prev.anchor ? +(s.anchorY - prev.anchorY).toFixed(2) : 'n/a', historyReqs: reqs.slice(before).map((r) => r.u.split('?')[0]).join(' ') || '-' });
    prev = s;
    if (want !== null) await waitWaiting();
  }
  await fake('/control/release?n=1');
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/hist-end.png` });
  console.log('nav', rows[0].nav);
  console.table(rows.map(({ tag, view, anchor, anchorY, shift, firstVisible, fromTop, fromBottom, stripH, historyReqs }) => ({ tag, view, anchor, anchorY, shift, firstVisible, fromTop, fromBottom, stripH, historyReqs })));
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ arm: ARM, rows, reqs }, null, 1));
  await b.close();
})();
