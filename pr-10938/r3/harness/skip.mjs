// Round 3: layer-skipping edges next to MULTI-node layers + a 3-layer skip (session r3SKIP),
// fresh loads per arm x width, plus a live-resize arm on head3.
import { launch, openPage, gotoSession, sleep, FIGS, writeJson, sid, noise } from './lib3.mjs';
import { EDGE_FACTS } from './edgefacts.mjs';
const SKIP = sid('r3SKIP');
const ARMS = (process.env.ARMS || 'base,head2,head3').split(',');
const WIDTHS = [1440, 700, 430, 390];
const browser = await launch();
const dset = (pg) => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-plan-edge]')].map((p) => [`${p.getAttribute('data-from')}->${p.getAttribute('data-to')}`, p.getAttribute('d')])));
async function stable(pg) {
  let prev = '';
  for (let i = 0; i < 25; i++) {
    const cur = JSON.stringify(await dset(pg));
    if (cur !== '{}' && cur === prev) return JSON.parse(cur);
    prev = cur; await sleep(400);
  }
  return JSON.parse(prev || '{}');
}
const r1 = (v) => Math.round(v * 10) / 10;
function analyse(f) {
  const cols = [...new Map(f.nodes.map((n) => [n.l, n.r])).entries()].sort((a, b) => a[0] - b[0]);
  const gutters = cols.slice(0, -1).map(([, r], i) => [r, cols[i + 1][0]]);
  const lanes = f.edges.filter((e) => e.kind === 'lane').map((e) => ({
    edge: `${e.from}->${e.to}`,
    verts: e.verts.map((v) => { const g = gutters.find(([a, b]) => v.x > a && v.x < b); return { x: v.x, inGutter: g ? `${g[0]}-${g[1]}` : 'NO', offCentre: g ? r1(v.x - (g[0] + g[1]) / 2) : null }; }),
    tangent: e.tangent, arrowhead: e.arrowhead, crossings: e.crossings.map((c) => `${c.node}(in ${c.insideLeftEdgeBy}px, ${c.overlapPx}px tall)`),
  }));
  return { gap: f.gap, columns: cols.map(([l]) => l), lanes, adjacentHeads: [...new Set(f.edges.filter((e) => e.kind === 'adjacent').map((e) => e.arrowhead))], totalCrossings: f.edges.reduce((s, e) => s + e.crossings.length, 0) };
}
const facts = {};
for (const width of WIDTHS) {
  for (const arm of ARMS) {
    const { page: pg, problems, context } = await openPage(browser, { width, height: 1000, dsf: 2 });
    await gotoSession(pg, arm, SKIP, { theme: 'dark', view: 'cockpit' });
    await pg.locator('[data-plan-node-id="c1"]').first().waitFor({ timeout: 30000 });
    const d = await stable(pg);
    const f = await pg.evaluate(EDGE_FACTS);
    const a = analyse(f);
    facts[`${width}-${arm}`] = { ...a, d, nodes: f.nodes, problems: problems.filter((p) => !noise(p)) };
    console.log(width, arm, a.gap, 'cols', JSON.stringify(a.columns), 'crossings', a.totalCrossings, 'adjHeads', a.adjacentHeads.join('/'), 'problems', facts[`${width}-${arm}`].problems.length);
    for (const l of a.lanes) console.log('   ', l.edge, JSON.stringify(l.verts), 'tan', JSON.stringify(l.tangent), l.arrowhead, l.crossings.join(' '));
    if (width === 390 || width === 1440) {
      const scroller = pg.locator('[data-plan-node-id]').first().locator('xpath=ancestor::*[contains(@class,"dagCanvas")]/..');
      await scroller.evaluate((el) => { el.scrollLeft = 0; });
      await sleep(300);
      await scroller.screenshot({ path: `${FIGS}/skip-${width}-${arm}-left.png` });
      if (width === 390) {
        await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        await sleep(300);
        await scroller.screenshot({ path: `${FIGS}/skip-${width}-${arm}-right.png` });
      }
    }
    await context.close();
  }
}
// live resize on head3: 1440 -> 700 -> 390 -> 1440, compared with the fresh loads above
const resize = [];
{
  const { page: pg, context } = await openPage(browser, { width: 1440, height: 1000 });
  await gotoSession(pg, 'head3', SKIP, { theme: 'dark', view: 'cockpit' });
  await pg.locator('[data-plan-node-id="c1"]').first().waitFor({ timeout: 30000 });
  for (const w of [1440, 700, 390, 1440]) {
    await pg.setViewportSize({ width: w, height: 1000 });
    const d = await stable(pg);
    const fresh = facts[`${w}-head3`].d;
    const keys = Object.keys(fresh);
    const same = keys.length === Object.keys(d).length && keys.every((k) => d[k] === fresh[k]);
    const f = await pg.evaluate(EDGE_FACTS);
    resize.push({ width: w, identicalToFreshLoad: same, crossings: analyse(f).totalCrossings, diff: same ? [] : keys.filter((k) => d[k] !== fresh[k]).map((k) => ({ k, live: d[k], fresh: fresh[k] })) });
    console.log('resize', w, 'identical to fresh load:', same, 'crossings', analyse(f).totalCrossings);
  }
  await context.close();
}
writeJson('skip-facts.json', { session: SKIP, facts, resize });
await browser.close();
