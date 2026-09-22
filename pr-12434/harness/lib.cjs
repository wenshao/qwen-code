// Shared helpers for driving the real Web Shell trajectory panel against a
// real `qwen serve` daemon. No page.route unless a scenario injects a fault.
const path = require('node:path');
const pw = require('/root/verify/pr12434-head/node_modules/@playwright/test');

const TOKEN = 'tok-12434';

async function launch(browserName = 'chromium', opts = {}) {
  const browserType = pw[browserName];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: opts.dpr ?? 2,
    colorScheme: opts.colorScheme ?? 'light',
  });
  const page = await context.newPage();
  const wire = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (/\/session\/[^/]+\/transcript$/.test(u.pathname)) {
      wire.push({ t: Date.now(), search: u.search.replace(/^\?/, '') });
    }
  });
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (/\/session\/[^/]+\/transcript$/.test(u.pathname)) {
      const entry = [...wire].reverse().find((w) => w.search === u.search.replace(/^\?/, '') && w.status === undefined);
      if (entry) {
        entry.status = res.status();
        try {
          const body = await res.json();
          entry.events = body.events?.length;
          entry.hasMore = body.hasMore;
          entry.nextCursor = body.nextCursor ? body.nextCursor.slice(0, 12) + '…' : undefined;
          entry.code = body.code;
          entry.recordIds = (body.events ?? [])
            .map((e) => e?.data?._meta?.['qwen.session.recordId'])
            .filter(Boolean);
        } catch {}
      }
    }
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  return { browser, context, page, wire };
}

async function openTrajectory(page, base, sessionId) {
  await page.goto(`${base}/session/${encodeURIComponent(sessionId)}?token=${TOKEN}`);
  await page.locator('[data-web-shell-root]:not([data-web-shell-gate])').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Toggle right panel' }).click();
  await page.waitForTimeout(800);
  await page.getByTestId('right-panel-open-trajectory').click();
  const grid = page.getByTestId('trajectory-rows');
  await grid.waitFor({ state: 'visible', timeout: 60000 });
  // let the tail effect settle
  await page.waitForTimeout(400);
  return grid;
}

/** Visible rows with their text and screen position, top to bottom. */
async function visibleRows(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="trajectory-rows"]');
    const g = grid.getBoundingClientRect();
    return [...grid.querySelectorAll('[role="row"]')]
      .map((r) => ({ text: r.textContent, y: r.getBoundingClientRect().top, idx: Number(r.getAttribute('aria-rowindex')) }))
      .filter((r) => r.y >= g.top && r.y + 34 <= g.bottom)
      .sort((a, b) => a.y - b.y);
  });
}

async function gridState(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="trajectory-rows"]');
    const bar = grid?.previousElementSibling;
    const barIsBar = bar && !bar.matches('[role=grid]');
    return {
      rowcount: Number(grid?.getAttribute('aria-rowcount')),
      scrollTop: grid?.scrollTop,
      scrollHeight: grid?.scrollHeight,
      clientHeight: grid?.clientHeight,
      gridTop: grid?.getBoundingClientRect().top,
      barText: barIsBar ? bar.textContent : null,
      barHeight: barIsBar ? bar.getBoundingClientRect().height : null,
      totals: document.querySelector('[data-testid="trajectory-totals"]')?.textContent ?? null,
      alert: document.querySelector('[data-testid="trajectory-panel"] [role="alert"]')?.textContent ?? null,
    };
  });
}

/**
 * Install a rAF sampler that records, every frame, where the row carrying
 * `anchorText` is painted. rAF runs right before paint, so a frame where the
 * row sat somewhere else is a frame the reader saw.
 */
async function startSampler(page, anchorText) {
  await page.evaluate((anchorText) => {
    window.__samples = [];
    window.__sampling = true;
    const tick = () => {
      if (!window.__sampling) return;
      const grid = document.querySelector('[data-testid="trajectory-rows"]');
      const rows = grid ? [...grid.querySelectorAll('[role="row"]')] : [];
      const row = rows.find((r) => r.textContent === anchorText);
      window.__samples.push({
        t: performance.now(),
        y: row ? row.getBoundingClientRect().top : null,
        rowcount: Number(grid?.getAttribute('aria-rowcount')),
        scrollTop: grid?.scrollTop,
        loading: !!document.querySelector('[data-testid="trajectory-load-older"]:disabled'),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, anchorText);
}

async function stopSampler(page) {
  return page.evaluate(() => {
    window.__sampling = false;
    return window.__samples;
  });
}

async function scrollGridTo(page, where) {
  // A real wheel over the grid, then fine adjustment so the offset is exact.
  const grid = page.getByTestId('trajectory-rows');
  const box = await grid.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(700);
  const target = await page.evaluate((where) => {
    const el = document.querySelector('[data-testid="trajectory-rows"]');
    const max = el.scrollHeight - el.clientHeight;
    // fractional positions snap to a row boundary so the anchor is whole
    const t = where === 'top' ? 0 : where === 'tail' ? max : Math.round((max * where) / 34) * 34 + 7;
    el.scrollTop = t;
    return t;
  }, where);
  await page.waitForTimeout(400);
  const now = await page.evaluate(() => document.querySelector('[data-testid="trajectory-rows"]').scrollTop);
  if (Math.abs(now - target) > 1 && where !== 'tail') console.log('WARN scroll target', target, 'got', now);
}

/** Pick a unique, fully visible row near the middle of the viewport. */
async function pickAnchor(page, prefer = 'middle') {
  const rows = await visibleRows(page);
  const counts = new Map();
  for (const r of rows) counts.set(r.text, (counts.get(r.text) ?? 0) + 1);
  const unique = rows.filter((r) => counts.get(r.text) === 1 && /Prompt #\d+/.test(r.text));
  const pool = unique.length > 0 ? unique : rows.filter((r) => counts.get(r.text) === 1);
  if (pool.length === 0) throw new Error('no unique visible row');
  if (prefer === 'first') return pool[0];
  if (prefer === 'last') return pool[pool.length - 1];
  return pool[Math.floor(pool.length / 2)];
}

async function waitPageLanded(page, beforeCount, timeout = 30000) {
  await page.waitForFunction(
    (before) => {
      const grid = document.querySelector('[data-testid="trajectory-rows"]');
      const alert = document.querySelector('[data-testid="trajectory-panel"] [role="alert"]');
      const loading = document.querySelector('[data-testid="trajectory-load-older"]:disabled');
      return (Number(grid?.getAttribute('aria-rowcount')) > before && !loading) || alert;
    },
    beforeCount,
    { timeout },
  );
  // two frames for layout effects + paint
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

/**
 * One anchoring trial: put the reader somewhere, pick a row, click the real
 * button with a real mouse, and report how far that row moved.
 */
async function anchorTrial(page, where, label) {
  await scrollGridTo(page, where);
  const s0 = await gridState(page);
  const anchor = await pickAnchor(page, where === 'top' ? 'first' : 'middle');
  await startSampler(page, anchor.text);
  const button = page.getByTestId('trajectory-load-older');
  await button.click();
  await waitPageLanded(page, s0.rowcount);
  await page.waitForTimeout(300);
  const samples = await stopSampler(page);
  const s1 = await gridState(page);
  const rowsNow = await page.evaluate((text) => {
    const grid = document.querySelector('[data-testid="trajectory-rows"]');
    const row = [...grid.querySelectorAll('[role="row"]')].find((r) => r.textContent === text);
    return row ? row.getBoundingClientRect().top : null;
  }, anchor.text);
  const landedIdx = samples.findIndex((s) => s.rowcount > s0.rowcount);
  const after = landedIdx >= 0 ? samples.slice(landedIdx) : [];
  const painted = after.filter((s) => s.y !== null).map((s) => s.y - anchor.y);
  const missing = after.filter((s) => s.y === null).length;
  return {
    label,
    where,
    anchor: anchor.text.slice(0, 60),
    rowsBefore: s0.rowcount,
    rowsAfter: s1.rowcount,
    rowsAdded: s1.rowcount - s0.rowcount,
    scrollBefore: s0.scrollTop,
    scrollAfter: s1.scrollTop,
    scrollDelta: s1.scrollTop - s0.scrollTop,
    expectedDelta: (s1.rowcount - s0.rowcount) * 34,
    anchorYBefore: anchor.y,
    anchorYAfter: rowsNow,
    moved: rowsNow === null ? null : +(rowsNow - anchor.y).toFixed(2),
    framesAfterLanding: after.length,
    framesAnchorOffscreen: missing,
    maxFrameDeviation: painted.length ? Math.max(...painted.map(Math.abs)) : null,
    barBefore: s0.barText,
    barAfter: s1.barText,
    barHeightBefore: s0.barHeight,
    barHeightAfter: s1.barHeight,
    gridTopBefore: s0.gridTop,
    gridTopAfter: s1.gridTop,
    totalsAfter: s1.totals,
    alert: s1.alert,
  };
}

module.exports = {
  pw, TOKEN, launch, openTrajectory, visibleRows, gridState, startSampler, stopSampler,
  scrollGridTo, pickAnchor, waitPageLanded, anchorTrial, path,
};
