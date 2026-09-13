// Is the 1440px lane translation (head3 x=254 vs head2 x=386) deterministic or load-state noise?
import { launch, openPage, gotoSession, sleep, sid } from './lib3.mjs';
const DAG = sid('r2DAG');
const browser = await launch();
const probe = () => {
  const node = document.querySelector('[data-plan-node-id]');
  const canvas = node.closest('[class*="dagCanvas"]');
  const sc = canvas.parentElement;
  const lane = [...document.querySelectorAll('[data-plan-edge]')].find((p) => p.getAttribute('d').includes('V'));
  const cr = canvas.getBoundingClientRect();
  const firstCol = Math.min(...[...document.querySelectorAll('[data-plan-node-id]')].map((b) => b.closest('article').getBoundingClientRect().left)) - cr.left;
  return { laneStart: lane?.getAttribute('d').slice(0, 14), canvasW: Math.round(cr.width), canvasLeft: Math.round(cr.left), firstColInCanvas: Math.round(firstCol), justify: getComputedStyle(canvas).justifyContent, scroll: `${sc.scrollLeft}/${sc.scrollWidth}/${sc.clientWidth}`, gridCols: getComputedStyle(canvas).gridTemplateColumns.slice(0, 60) };
};
for (const arm of ['head2', 'head3', 'lanefix', 'base', 'head3', 'head2']) {
  const { page: pg, context } = await openPage(browser, { width: 1440, height: 900, dsf: 2 });
  await gotoSession(pg, arm, DAG, { theme: 'dark', view: 'cockpit' });
  await pg.locator('[data-plan-node-id="compare-findings"]').first().waitFor({ timeout: 30000 });
  const samples = [];
  for (const t of [300, 1500, 4000]) { await sleep(t); samples.push(await pg.evaluate(probe)); }
  await pg.locator('[data-plan-node-id="compare-findings"]').first().scrollIntoViewIfNeeded();
  await sleep(1500);
  samples.push(await pg.evaluate(probe));
  console.log(arm, samples.map((s) => `${s.laneStart} canvasW=${s.canvasW} col0=${s.firstColInCanvas} scroll=${s.scroll} ${s.justify}`).join('  ||  '));
  await context.close();
}
await browser.close();
