// PR #12134 round 4 driver: real `qwen serve` + production (or vite-dev) web-shell,
// scripted fake model, real wheel/click input. Usage:
//   ARM=head BASE=http://127.0.0.1:4234 node drive.cjs <scenario...>
// scenarios: parked (mount/steps/unmount while scrolled up), follow (batch
// shrink + streaming while following), collapse (collapse/expand while following)
const { chromium } = require('playwright');
const fs = require('fs');
const ARM = process.env.ARM || 'head';
const BASE = process.env.BASE || 'http://127.0.0.1:4234';
const FAKE = 'http://127.0.0.1:18134';
const OUT = process.env.OUT || `/root/verify/pr12134/results/${ARM}`;
const VW = Number(process.env.VW || 1280), VH = Number(process.env.VH || 800);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fake = async (p) => (await fetch(FAKE + p)).json();
const results = { arm: ARM, base: BASE, viewport: [VW, VH], scenarios: {} };

const SAMPLER = () => {
  window.__samples = [];
  window.__sampling = false;
  window.__findStrip = () =>
    [...document.querySelectorAll('section[aria-label="Current tasks"]')].find(
      (s) => s.parentElement && s.parentElement.querySelector('[data-web-shell-message-list]'),
    ) || null;
  window.__sample = () => {
    const list = document.querySelector('[data-web-shell-message-list]');
    if (!list) return null;
    const r = list.getBoundingClientRect();
    const strip = window.__findStrip();
    let lineY = null;
    if (window.__anchorText) {
      let el = window.__anchorEl;
      if (!el || !el.isConnected)
        el = window.__anchorEl = [...list.querySelectorAll('p')].find((p) =>
          (p.textContent || '').startsWith(window.__anchorText),
        );
      if (el) lineY = el.getBoundingClientRect().top;
    }
    const prog = strip && strip.querySelector('[class*="progress"]');
    return {
      t: Math.round(performance.now()),
      listTop: +r.top.toFixed(2),
      scrollTop: +list.scrollTop.toFixed(2),
      clientHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
      fromBottom: +(list.scrollHeight - list.scrollTop - list.clientHeight).toFixed(2),
      anchorY: +(r.top - list.scrollTop).toFixed(2),
      lineY: lineY === null ? null : +lineY.toFixed(2),
      stripH: strip ? +strip.getBoundingClientRect().height.toFixed(2) : 0,
      step: prog ? prog.textContent : null,
    };
  };
  // Two samplers per frame: `pre` runs in rAF (forces layout BEFORE this
  // frame's ResizeObserver callbacks, so it can see states that are never
  // painted); `post` runs in a task queued from rAF, i.e. after the frame's
  // RO callbacks and paint, so it reflects the painted state.
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    const s = window.__sample();
    if (s) window.__post.push(s);
  };
  window.__post = [];
  const loop = () => {
    if (window.__sampling) {
      const s = window.__sample();
      if (s) window.__samples.push(s);
      ch.port2.postMessage(0);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

async function sample(page) { return page.evaluate(() => window.__sample()); }
async function settle(page, ms = 700) { await sleep(ms); return sample(page); }
async function send(page, text) {
  const ed = page.locator('[data-web-shell-composer-editor] .cm-content').first();
  await ed.click();
  await page.keyboard.type(text);
  await page.locator('[data-web-shell-composer-submit]').first().click();
}
async function waitWaiting(n = 1, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await fake('/control/state');
    if (s.waiting >= n) return s;
    await sleep(100);
  }
  throw new Error('fake model never got a held request');
}
async function waitStep(page, want, timeout = 20000) {
  await page.waitForFunction(
    (w) => {
      const s = window.__findStrip();
      if (w === null) return !s;
      const p = s && s.querySelector('[class*="progress"]');
      return !!p && p.textContent === w;
    },
    want,
    { timeout },
  );
}
async function waitIdle(page, timeout = 30000, marker = null) {
  // turn finished: the fake model's last text is on screen and the fake has
  // no held request left
  if (marker) await page.getByText(marker, { exact: false }).first().waitFor({ timeout });
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await fake('/control/state');
    if (s.waiting === 0) break;
    await sleep(100);
  }
  await sleep(800);
}
async function wheelTo(page, dy, times) {
  const box = await page.locator('[data-web-shell-message-list]').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, dy);
    await sleep(60);
  }
}
async function pickAnchor(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[data-web-shell-message-list]');
    const lr = list.getBoundingClientRect();
    const p = [...list.querySelectorAll('p')].find((el) => {
      const r = el.getBoundingClientRect();
      return /^(LINE|TAIL)-\d{3}/.test(el.textContent || '') && r.top > lr.top + 150 && r.top < lr.top + 350;
    });
    window.__anchorText = p ? p.textContent.slice(0, 8) : null;
    window.__anchorEl = p || null;
    return window.__anchorText;
  });
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(SAMPLER);
  await page.goto(BASE + '/');
  await page.locator('[data-web-shell-composer-editor] .cm-content').first().waitFor({ timeout: 30000 });
  const asset = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => /index-/.test(s)).join(','));
  results.asset = asset;
  return { ctx, page };
}

async function seed(page) {
  await send(page, 'SEED 120');
  await waitIdle(page, 30000, 'LINE-120');
  await sleep(800);
}

// ---- scenario: reader parked 600px up; strip mounts, shrinks per step, unmounts
async function parked(page) {
  const rows = [];
  await send(page, 'PLAN steps7');
  await waitWaiting(1);
  await sleep(500);
  await wheelTo(page, -200, 3);
  await sleep(900);
  const anchor = await pickAnchor(page);
  let prev = await sample(page);
  rows.push({ event: 'parked', anchor, ...prev });
  const expect = ['Step 1 / 7', 'Step 2 / 7', 'Step 3 / 7', 'Step 4 / 7', 'Step 5 / 7', 'Step 6 / 7', 'Step 7 / 7', null];
  for (let i = 0; i < expect.length; i++) {
    if (expect[i] === null) {
      await page.evaluate(() => { const el = window.__anchorEl; if (el) { el.style.outline = '2px solid #f85149'; el.style.outlineOffset = '2px'; } });
      await sleep(200);
      results.beforeComplete = await sample(page);
      await shot(page, 'parked-before-complete');
    }
    await page.evaluate(() => { window.__samples = []; window.__sampling = true; });
    await fake('/control/release?n=1');
    await waitStep(page, expect[i]);
    const s = await settle(page);
    if (expect[i] === null) { results.afterComplete = s; await shot(page, 'parked-after-complete'); }
    const frames = await page.evaluate(() => { window.__sampling = false; return window.__samples; });
    const maxDev = frames.reduce((m, f) => (f.lineY !== null && prev.lineY !== null ? Math.max(m, Math.abs(f.lineY - prev.lineY)) : m), 0);
    rows.push({ event: i === 0 ? 'mount' : expect[i] === null ? 'unmount' : 'step', expect: expect[i], shift: s.lineY !== null && prev.lineY !== null ? +(s.lineY - prev.lineY).toFixed(2) : null, anchorShift: +(s.anchorY - prev.anchorY).toFixed(2), stripDelta: +(s.stripH - prev.stripH).toFixed(2), maxFrameDev: +maxDev.toFixed(2), frames: frames.length, ...s });
    if (i === 3) await shot(page, 'parked-step4');
    prev = s;
    if (expect[i] !== null) await waitWaiting(1);
  }
  await fake('/control/release?n=1');
  await waitIdle(page, 30000, 'All seven steps are complete.');
  results.scenarios.parked = rows;
  console.table(rows.map(({ event, expect, shift, anchorShift, stripDelta, maxFrameDev, fromBottom, stripH }) => ({ event, expect, shift, anchorShift, stripDelta, maxFrameDev, fromBottom, stripH })));
}

async function toBottom(page) {
  await wheelTo(page, 4000, 8);
  await sleep(1200);
  return sample(page);
}

// ---- scenario: reader following the bottom; batch completion shrinks the strip
// by 3 rows at once, then a reply streams in.
async function follow(page) {
  const rows = [];
  let prev = await toBottom(page);
  rows.push({ event: 'at-bottom', ...prev });
  await send(page, 'PLAN batch7:60');
  await waitWaiting(1);
  await sleep(600);
  prev = await sample(page);
  const plan = [
    { expect: 'Step 1 / 7', label: 'mount (grow)' },
    { expect: 'Step 3 / 7', label: 'complete 2 (1 row)' },
    { expect: 'Step 6 / 7', label: 'complete 3,4,5 at once (3 rows)' },
  ];
  for (const p of plan) {
    await page.evaluate(() => { window.__samples = []; window.__sampling = true; });
    await fake('/control/release?n=1');
    await waitStep(page, p.expect);
    const s = await settle(page, 900);
    const frames = await page.evaluate(() => { window.__sampling = false; return window.__samples; });
    const maxFB = frames.reduce((m, f) => Math.max(m, f.fromBottom), 0);
    rows.push({ event: p.label, stripDelta: +(s.stripH - prev.stripH).toFixed(2), settledFromBottom: s.fromBottom, maxFrameFromBottom: +maxFB.toFixed(2), frames: frames.length, ...s });
    if (p.label.startsWith('complete 3')) await shot(page, 'follow-after-batch');
    prev = s;
    await waitWaiting(1);
  }
  // stream 60 TAIL paragraphs; follow mode should keep the newest one in view
  await page.evaluate(() => { window.__samples = []; window.__sampling = true; });
  await fake('/control/release?n=1');
  await waitIdle(page, 60000, 'TAIL-060');
  const s = await settle(page, 900);
  const frames = await page.evaluate(() => { window.__sampling = false; return window.__samples; });
  const tailVisible = await page.evaluate(() => {
    const list = document.querySelector('[data-web-shell-message-list]');
    const lr = list.getBoundingClientRect();
    const p = [...list.querySelectorAll('p')].find((el) => (el.textContent || '').startsWith('TAIL-060'));
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.bottom > lr.top && r.top < lr.bottom;
  });
  const maxFB = frames.reduce((m, f) => Math.max(m, f.fromBottom), 0);
  rows.push({ event: 'stream 60 paragraphs', settledFromBottom: s.fromBottom, maxFrameFromBottom: +maxFB.toFixed(2), tailVisible, frames: frames.length, ...s });
  await shot(page, 'follow-after-stream');
  results.scenarios.follow = rows;
  console.table(rows.map(({ event, stripDelta, settledFromBottom, maxFrameFromBottom, tailVisible, stripH, step }) => ({ event, stripDelta, settledFromBottom, maxFrameFromBottom, tailVisible, stripH, step })));
}

// ---- scenario: reader following the bottom clicks collapse, then expand
async function collapse(page) {
  const rows = [];
  await send(page, 'PLAN hold7');
  await waitWaiting(1);
  await fake('/control/release?n=1');
  await waitStep(page, 'Step 3 / 7');
  await waitWaiting(1);
  let prev = await toBottom(page);
  rows.push({ event: 'at-bottom', ...prev });
  const toggle = async (label) => {
    await page.evaluate(() => { window.__samples = []; window.__sampling = true; });
    await page.evaluate(() => window.__findStrip().querySelector('button[aria-expanded]').click());
    const s = await settle(page, 900);
    const frames = await page.evaluate(() => { window.__sampling = false; return window.__samples; });
    const maxFB = frames.reduce((m, f) => Math.max(m, f.fromBottom), 0);
    rows.push({ event: label, stripDelta: +(s.stripH - prev.stripH).toFixed(2), settledFromBottom: s.fromBottom, maxFrameFromBottom: +maxFB.toFixed(2), frames: frames.length, ...s });
    prev = s;
  };
  await toggle('collapse');
  await shot(page, 'collapse-at-bottom');
  await toggle('expand');
  // repeat to separate painted from pre-layout states
  const rep = [];
  for (let i = 0; i < 6; i++) {
    for (const label of ['collapse', 'expand']) {
      await page.evaluate(() => { window.__samples = []; window.__post = []; window.__sampling = true; });
      await page.evaluate(() => window.__findStrip().querySelector('button[aria-expanded]').click());
      await sleep(900);
      const { pre, post } = await page.evaluate(() => { window.__sampling = false; return { pre: window.__samples, post: window.__post }; });
      rep.push({ i, label, preFramesOff: pre.filter((f) => f.fromBottom > 1).length, preMax: Math.max(0, ...pre.map((f) => f.fromBottom)), postFramesOff: post.filter((f) => f.fromBottom > 1).length, postMax: Math.max(0, ...post.map((f) => f.fromBottom)), frames: pre.length, settled: (await sample(page)).fromBottom });
    }
  }
  results.scenarios.toggleRepeat = rep;
  console.table(rep);
  await fake('/control/release?n=2');
  await waitIdle(page, 30000, 'All seven steps are complete.');
  results.scenarios.collapse = rows;
  console.table(rows.map(({ event, stripDelta, settledFromBottom, maxFrameFromBottom, stripH }) => ({ event, stripDelta, settledFromBottom, maxFrameFromBottom, stripH })));
}

// ---- scenario: reader following the bottom while the plan completes (unmount)
async function followEnd(page) {
  const rows = [];
  let prev = await toBottom(page);
  rows.push({ event: 'at-bottom', ...prev });
  await send(page, 'PLAN steps7');
  await waitWaiting(1);
  await sleep(600);
  const expect = ['Step 1 / 7', 'Step 2 / 7', 'Step 3 / 7', 'Step 4 / 7', 'Step 5 / 7', 'Step 6 / 7', 'Step 7 / 7', null];
  for (let i = 0; i < expect.length; i++) {
    await page.evaluate(() => { window.__samples = []; window.__post = []; window.__sampling = true; });
    await fake('/control/release?n=1');
    await waitStep(page, expect[i]);
    const s = await settle(page, 900);
    const { post } = await page.evaluate(() => { window.__sampling = false; return { post: window.__post }; });
    rows.push({ event: expect[i] ?? 'unmount', settledFromBottom: s.fromBottom, postMax: Math.max(0, ...post.map((f) => f.fromBottom)), stripH: s.stripH });
    if (expect[i] !== null) await waitWaiting(1);
  }
  await fake('/control/release?n=1');
  await waitIdle(page, 30000, 'All seven steps are complete.');
  const s = await settle(page, 900);
  rows.push({ event: 'final reply', settledFromBottom: s.fromBottom });
  results.scenarios.followEnd = rows;
  console.table(rows.map(({ event, settledFromBottom, postMax, stripH }) => ({ event, settledFromBottom, postMax, stripH })));
}

(async () => {
  const which = process.argv.slice(2);
  await fetch(FAKE + '/control/reset');
  const browser = await chromium.launch();
  const { ctx, page } = await boot(browser);
  try {
    await seed(page);
    for (const w of which) {
      if (w === 'parked') await parked(page);
      if (w === 'follow') await follow(page);
      if (w === 'collapse') await collapse(page);
      if (w === 'toggle') await collapse(page);
      if (w === 'followEnd') await followEnd(page);
    }
  } catch (e) {
    console.log('ERROR', e.message);
    await shot(page, 'error');
    results.error = e.message;
  } finally {
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
    console.log('asset', results.asset);
    await ctx.close();
    await browser.close();
  }
})();
