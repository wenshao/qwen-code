// Which element covers the plan graph in narrow cockpit captures, and does Escape / a close control dismiss it?
import { launch, openPage, gotoSession, sleep, sid } from './lib3.mjs';
const browser = await launch();
const probe = () => {
  const svg = document.querySelector('[data-plan-edge]')?.ownerSVGElement;
  if (!svg) return { svg: null };
  const vp = svg.closest('[class*="dagViewport"]') || svg.parentElement;
  const r = vp.getBoundingClientRect();
  const pts = [[0.25, 0.3], [0.5, 0.5], [0.75, 0.7]].map(([fx, fy]) => [Math.round(r.left + r.width * fx), Math.round(Math.min(innerHeight - 5, r.top + Math.min(r.height, innerHeight - r.top) * fy))]);
  const chain = (el) => { const out = []; for (let e = el; e && out.length < 6; e = e.parentElement) out.push(`${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''}${e.getAttribute('data-state') ? `[data-state=${e.getAttribute('data-state')}]` : ''}.${String(e.className).split(' ')[0].slice(0, 28)}`); return out.join(' < '); };
  const hits = pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return { x, y, insideGraph: !!el && vp.contains(el), el: el ? chain(el) : null }; });
  const dialogs = [...document.querySelectorAll('[role=dialog],[data-state=open],[aria-modal=true]')].map((d) => chain(d)).slice(0, 5);
  const selected = document.querySelector('[data-plan-node-id][aria-pressed=true], [data-selected=true] [data-plan-node-id]')?.getAttribute('data-plan-node-id') ?? null;
  return { vpRect: [r.left, r.top, r.width, r.height].map(Math.round), hits, dialogs, selected, url: location.search };
};
for (const [label, waitId] of [['r3SKIP', 'c1'], ['r2DAG', 'compare-findings']]) {
  for (const width of [390, 700]) {
    const { page: pg, context } = await openPage(browser, { width, height: 2000, dsf: 1 });
    await gotoSession(pg, 'head3', sid(label), { theme: 'dark', view: 'cockpit' });
    await pg.locator(`[data-plan-node-id="${waitId}"]`).first().waitFor({ timeout: 30000 });
    const t = [];
    for (const ms of [500, 2500, 6000]) { await sleep(ms); t.push({ at: ms, ...(await pg.evaluate(probe)) }); }
    console.log(`\n== ${label} ${width}`);
    for (const s of t) console.log(`  +${s.at}ms selected=${s.selected} vp=${JSON.stringify(s.vpRect)} hits=${s.hits.map((h) => (h.insideGraph ? 'graph' : `COVERED by ${h.el}`)).join(' | ')} dialogs=${JSON.stringify(s.dialogs)}`);
    await pg.keyboard.press('Escape'); await sleep(800);
    const e = await pg.evaluate(probe);
    console.log(`  after Escape: hits=${e.hits.map((h) => (h.insideGraph ? 'graph' : `COVERED by ${h.el}`)).join(' | ')} dialogs=${JSON.stringify(e.dialogs)}`);
    const closers = await pg.evaluate(() => [...document.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')).filter((l) => /close|dismiss|hide|back|collapse/i.test(l)).slice(0, 8));
    console.log('  close-like buttons:', JSON.stringify(closers));
    await context.close();
  }
}
await browser.close();
