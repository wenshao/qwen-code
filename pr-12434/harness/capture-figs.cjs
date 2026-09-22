// Report figures with a guide line pinned at the anchor row's top edge.
// usage: node capture-figs.cjs <mode: anchor|endshift> <base> <sessionId> <outPrefix>
const fs = require('node:fs');
const L = require('./lib.cjs');

async function guide(page, y) {
  await page.evaluate((y) => {
    document.getElementById('__guide')?.remove();
    const d = document.createElement('div');
    d.id = '__guide';
    Object.assign(d.style, { position: 'fixed', left: '0', right: '0', top: `${y}px`, height: '0', borderTop: '2px dashed #ff3b30', zIndex: '99999', pointerEvents: 'none' });
    document.body.appendChild(d);
  }, y);
}

async function selectAnchor(page, text) {
  // a real click on the row: the selection highlight makes its edges visible
  const row = page.locator('[data-testid="trajectory-rows"] [role="row"]').filter({ hasText: text }).first();
  await row.click();
  await page.waitForTimeout(150);
  return (await row.boundingBox()).y;
}

(async () => {
  const [mode, base, sessionId, out] = process.argv.slice(2);
  const { browser, page } = await L.launch('chromium');
  await L.openTrajectory(page, base, sessionId);
  const panel = page.getByTestId('trajectory-panel');
  const pbox = await panel.boundingBox();
  const meta = {};
  if (mode === 'endshift') {
    // first page from the top, so the next one is the session's start
    await L.anchorTrial(page, 'top', 'warm');
  }
  await L.scrollGridTo(page, 0.5);
  const a = await L.pickAnchor(page);
  const anchorText = a.text.replace(/^you/, '').slice(0, 30);
  const y0 = await selectAnchor(page, anchorText);
  const s0 = await L.gridState(page);
  await guide(page, y0);
  const clip = mode === 'anchor'
    ? { x: pbox.x, y: pbox.y, width: pbox.width, height: Math.min(560, y0 - pbox.y + 150) }
    : { x: pbox.x, y: y0 - 22, width: pbox.width, height: 78 };
  const barClip = { x: pbox.x, y: pbox.y, width: pbox.width, height: 150 };
  await page.screenshot({ path: `${out}-before.png`, clip });
  if (mode === 'endshift') await page.screenshot({ path: `${out}-bar-before.png`, clip: barClip });
  await page.getByTestId('trajectory-load-older').click();
  await L.waitPageLanded(page, s0.rowcount);
  await page.waitForTimeout(400);
  const s1 = await L.gridState(page);
  const y1 = (await L.visibleRows(page)).find((r) => r.text === a.text)?.y ?? null;
  await guide(page, y0);
  await page.screenshot({ path: `${out}-after.png`, clip });
  if (mode === 'endshift') await page.screenshot({ path: `${out}-bar-after.png`, clip: barClip });
  Object.assign(meta, { anchor: anchorText, y0, y1, moved: y1 === null ? null : y1 - y0, rows: [s0.rowcount, s1.rowcount], scrollTop: [s0.scrollTop, s1.scrollTop], bar: [s0.barText, s1.barText], barHeight: [s0.barHeight, s1.barHeight], gridTop: [s0.gridTop, s1.gridTop], totals: [s0.totals, s1.totals] });
  fs.writeFileSync(`${out}.json`, JSON.stringify(meta, null, 1));
  console.log(JSON.stringify(meta));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
