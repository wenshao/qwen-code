// Narrow-width evidence crops (arrowhead, lane rise into write-summary, whole graph)
// per arm. Verifies with elementFromPoint that the graph — not the Workflow
// drawer — is on top at capture time, and records it.
// usage: ARMS=base,revert,head,lanefix node crops.mjs
import { launch, openPage, gotoSession, sleep, FIGS, writeJson, sid } from './lib2.mjs';

const arms = (process.env.ARMS || 'base,revert,head').split(',');
const DAG = sid('r2DAG');
const browser = await launch();
const facts = {};
const clampClip = (c, [vw, vh]) => {
  const x = Math.max(0, c.x), y = Math.max(0, c.y);
  const width = Math.min(vw, c.x + c.width) - x, height = Math.min(vh, c.y + c.height) - y;
  return width > 4 && height > 4 ? { x, y, width, height } : null;
};
const shot = async (pg, path, clip, vp) => { const c = clampClip(clip, vp); if (c) await pg.screenshot({ path, clip: c }); return !!c; };

const GEOM = () => {
  const paths = [...document.querySelectorAll('[data-plan-edge]')];
  const svg = paths[0]?.ownerSVGElement;
  const sr = svg.getBoundingClientRect();
  const rect = (id) => document.querySelector(`[data-plan-node-id="${id}"]`).closest('article').getBoundingClientRect();
  const end = (from, to) => {
    const p = paths.find((x) => x.getAttribute('data-from') === from && x.getAttribute('data-to') === to);
    const pt = p.getPointAtLength(p.getTotalLength());
    return [sr.left + pt.x, sr.top + pt.y];
  };
  const onTop = (id) => {
    const r = rect(id);
    const el = document.elementFromPoint(r.left + 8, r.top + 8);
    return el?.closest('[data-plan-node-id]') || el?.closest('article')?.querySelector(`[data-plan-node-id="${id}"]`) ? 'graph' : `covered:${el?.closest('[data-testid]')?.getAttribute('data-testid') ?? el?.tagName}`;
  };
  const cf = rect('compare-findings');
  const ws = rect('write-summary');
  return { arrowEnd: end('read-tests', 'compare-findings'), cf: [cf.left, cf.top, cf.right, cf.bottom], ws: [ws.left, ws.top, ws.right, ws.bottom], onTop: onTop('compare-findings'), viewport: [innerWidth, innerHeight] };
};

for (const width of (process.env.WIDTHS || '700,390').split(',').map(Number)) {
  for (const arm of arms) {
    const { page: pg, context } = await openPage(browser, { width, height: 900, dsf: 6 });
    await gotoSession(pg, arm, DAG, { theme: 'dark', view: 'cockpit' });
    await pg.locator('[data-plan-node-id="compare-findings"]').first().waitFor({ timeout: 30000 });
    await sleep(1500);
    let g = await pg.evaluate(GEOM);
    if (g.onTop !== 'graph') {
      await pg.keyboard.press('Escape');
      await sleep(600);
      g = await pg.evaluate(GEOM);
    }
    const [ax, ay] = g.arrowEnd;
    await shot(pg, `${FIGS}/crop-arrowhead-${width}-${arm}.png`, { x: ax - 26, y: ay - 14, width: 34, height: 28 }, g.viewport);
    // Lane rise: bottom-right of compare-findings up to write-summary's input.
    const x0 = g.cf[2] - 46, x1 = g.ws[0] + 26;
    const y0 = (g.ws[1] + g.ws[3]) / 2 - 26, y1 = Math.min(g.viewport[1], g.cf[3] + 60);
    const laneShot = await shot(pg, `${FIGS}/crop-lane-${width}-${arm}.png`, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, g.viewport);
    const box = await pg.locator('[data-plan-node-id]').first().evaluate((b) => {
      const r = b.closest('[class*="dagCanvas"]').parentElement.getBoundingClientRect();
      return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth - Math.max(0, r.left), r.width), height: Math.min(innerHeight - Math.max(0, r.top), r.height) };
    });
    await shot(pg, `${FIGS}/crop-graph-${width}-${arm}.png`, box, g.viewport);
    const after = await pg.evaluate(GEOM);
    facts[`${width}-${arm}`] = { laneShot, onTopBefore: g.onTop, onTopAfter: after.onTop, arrowEnd: g.arrowEnd, cf: g.cf, ws: g.ws };
    console.log('crops', width, arm, g.onTop, '->', after.onTop);
    await context.close();
  }
}
writeJson(`crops-${arms.join('_')}.json`, facts);
await browser.close();
