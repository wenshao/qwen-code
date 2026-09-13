// Byte-identity of every edge path at 1440px (head2 = round-2 head, lanefix = round-2 candidate, head3 = this head),
// measured in one settled cockpit layout, for both real sessions. Also 700px SKIP crops for the figure.
import { launch, openPage, gotoSession, sleep, FIGS, sid, writeJson } from './lib3.mjs';
const browser = await launch();
const grab = () => {
  const node = document.querySelector('[data-plan-node-id]');
  const canvas = node.closest('[class*="dagCanvas"]');
  return { canvasW: Math.round(canvas.getBoundingClientRect().width), scrollerW: canvas.parentElement.clientWidth,
    d: Object.fromEntries([...document.querySelectorAll('[data-plan-edge]')].map((p) => [`${p.getAttribute('data-from')}->${p.getAttribute('data-to')}`, p.getAttribute('d')])) };
};
const out = {};
for (const [label, waitId] of [['r2DAG', 'compare-findings'], ['r3SKIP', 'c1']]) {
  for (const arm of ['head2', 'lanefix', 'head3']) {
    const { page: pg, context } = await openPage(browser, { width: 1440, height: 1000 });
    await gotoSession(pg, arm, sid(label), { theme: 'dark', view: 'cockpit' });
    await pg.locator(`[data-plan-node-id="${waitId}"]`).first().waitFor({ timeout: 30000 });
    let g, prev = '';
    for (let i = 0; i < 20; i++) { g = await pg.evaluate(grab); const s = JSON.stringify(g); if (s === prev) break; prev = s; await sleep(500); }
    out[`${label}-${arm}`] = g;
    if (label === 'r3SKIP' && arm !== 'lanefix') {
      await pg.setViewportSize({ width: 700, height: 1000 });
      await sleep(2000);
      const sc = pg.locator('[data-plan-node-id]').first().locator('xpath=ancestor::*[contains(@class,"dagCanvas")]/..');
      await sc.screenshot({ path: `${FIGS}/skip-700-${arm}-left.png` });
    }
    await context.close();
  }
  const ref = out[`${label}-head3`];
  for (const arm of ['head2', 'lanefix']) {
    const o = out[`${label}-${arm}`];
    const keys = Object.keys(ref.d);
    const same = keys.length === Object.keys(o.d).length && keys.every((k) => o.d[k] === ref.d[k]);
    console.log(`${label} 1440: head3 vs ${arm}: ${keys.length} paths, byte-identical=${same}, canvasW ${ref.canvasW}/${o.canvasW}, scrollerW ${ref.scrollerW}/${o.scrollerW}`);
  }
}
writeJson('ident-1440.json', out);
await browser.close();
