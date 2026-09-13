// Report figures: the graph's visible region per arm, located from the edge SVG's real
// horizontal scroll container (not a class guess), same session + width + scroll offset per pair.
import { launch, openPage, gotoSession, sleep, FIGS, sid } from './lib3.mjs';
const browser = await launch();
async function graphShot(arm, label, waitId, width, name, scrollLeft = 0) {
  const { page: pg, problems, context } = await openPage(browser, { width, height: 2000, dsf: 2 });
  await gotoSession(pg, arm, sid(label), { theme: 'dark', view: 'cockpit' });
  await pg.locator(`[data-plan-node-id="${waitId}"]`).first().waitFor({ timeout: 30000 });
  await sleep(2500);
  const place = (sl) => {
    const svg = document.querySelector('[data-plan-edge]').ownerSVGElement;
    let sc = svg.parentElement;
    while (sc && !(['auto', 'scroll'].includes(getComputedStyle(sc).overflowX) && sc.scrollWidth > sc.clientWidth)) sc = sc.parentElement;
    svg.scrollIntoView({ block: 'start', inline: 'nearest' });
    if (sc) sc.scrollLeft = sl;
    const s = svg.getBoundingClientRect();
    const v = sc ? sc.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    return {
      vis: [Math.max(s.left, v.left, 0), Math.max(s.top, v.top, 0), Math.min(s.right, v.right, innerWidth), Math.min(s.bottom, v.bottom, innerHeight)],
      svg: [Math.round(s.left), Math.round(s.top), Math.round(s.width), Math.round(s.height)],
      scroller: sc ? `${String(sc.className).slice(0, 30)} ${sc.scrollLeft}/${sc.scrollWidth}/${sc.clientWidth}` : 'none(fits)',
      gap: getComputedStyle(document.querySelector('[data-plan-node-id]').closest('[class*="dagCanvas"]')).columnGap,
    };
  };
  await pg.evaluate(place, scrollLeft);
  await sleep(500);
  const info = await pg.evaluate(place, scrollLeft);
  const [x1, y1, x2, y2] = info.vis;
  await pg.screenshot({ path: `${FIGS}/${name}.png`, clip: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  console.log(name, JSON.stringify(info), 'problems', problems.length);
  await context.close();
}
for (const arm of ['head2', 'head3']) {
  await graphShot(arm, 'r3SKIP', 'c1', 390, `r3-skip-390-${arm}`, 0);
  await graphShot(arm, 'r3SKIP', 'c1', 700, `r3-skip-700-${arm}`, 0);
  await graphShot(arm, 'r2DAG', 'compare-findings', 390, `r3-dag-390-${arm}`, 0);
}
await browser.close();
