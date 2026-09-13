// Round-3 report figures. Each capture: dismiss the auto-opened inspector drawer (Escape) until
// elementFromPoint proves the graph is on top, clip to the edge SVG inside its real scroll viewport,
// and box the lane/step overlaps measured from the DOM at capture time.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { launch, openPage, gotoSession, sleep, FIGS, sid, R2 as R3DIR } from './lib3.mjs';
import { EDGE_FACTS } from './edgefacts.mjs';
const require = createRequire('/var/tmp/pr10938-wt/node_modules/');
const sharp = require('sharp');
const DSF = 2, LABEL = 84;
const COMP = `${R3DIR}/composites`; fs.mkdirSync(COMP, { recursive: true });
const browser = await launch();
const coveredProbe = () => {
  const vp = document.querySelector('[data-plan-edge]').ownerSVGElement.closest('[class*="dagViewport"]');
  const r = vp.getBoundingClientRect(); const h = Math.min(r.height, innerHeight - r.top);
  return [[0.2, 0.1], [0.5, 0.3], [0.85, 0.15], [0.5, 0.5]].filter(([fx, fy]) => { const el = document.elementFromPoint(r.left + r.width * fx, r.top + h * fy); return !el || !vp.contains(el); }).length;
};
async function shot(arm, label, waitId, width, name) {
  const { page: pg, context } = await openPage(browser, { width, height: 2000, dsf: DSF });
  await gotoSession(pg, arm, sid(label), { theme: 'dark', view: 'cockpit' });
  await pg.locator(`[data-plan-node-id="${waitId}"]`).first().waitFor({ timeout: 30000 });
  await sleep(2500);
  let covered = await pg.evaluate(coveredProbe), escapes = 0;
  while (covered && escapes < 4) { await pg.keyboard.press('Escape'); escapes++; await sleep(900); covered = await pg.evaluate(coveredProbe); }
  const place = await pg.evaluate(() => {
    const svg = document.querySelector('[data-plan-edge]').ownerSVGElement;
    const vp = svg.closest('[class*="dagViewport"]'); vp.scrollLeft = 0; window.scrollTo(0, 0);
    const s = svg.getBoundingClientRect(), v = vp.getBoundingClientRect();
    return { svg: [s.left, s.top], clip: [Math.max(s.left, v.left, 0), Math.max(s.top, v.top, 0), Math.min(s.right, v.right, innerWidth), Math.min(s.bottom, v.bottom, innerHeight)] };
  });
  await sleep(400);
  const f = await pg.evaluate(EDGE_FACTS);
  const [x1, y1, x2, y2] = place.clip;
  const file = `${FIGS}/${name}.png`;
  await pg.screenshot({ path: file, clip: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  const crossings = f.edges.flatMap((e) => e.crossings.map((c) => ({ edge: `${e.from}->${e.to}`, ...c })));
  const lanes = f.edges.filter((e) => e.kind === 'lane').map((e) => `${e.from}->${e.to} x=${e.verts.map((v) => v.x).join('/')} tan=${JSON.stringify(e.tangent)}`);
  console.log(name, 'gap', f.gap, 'escapes', escapes, 'stillCovered', covered, 'crossings', crossings.length, '|', lanes.join(' ; '));
  await context.close();
  return { file, offX: x1 - place.svg[0], offY: y1 - place.svg[1], crossings, covered };
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const labelSvg = (w, title, sub, accent) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL}"><rect width="100%" height="100%" fill="#1f1f1f"/><rect width="8" height="${LABEL}" fill="${accent}"/><text x="24" y="36" font-family="DejaVu Sans" font-size="26" font-weight="bold" fill="#f2f2f2">${esc(title)}</text><text x="24" y="70" font-family="DejaVu Sans" font-size="21" fill="#c4c4c4">${esc(sub)}</text></svg>`);
async function panel(s, title, sub, accent, annotate) {
  const { width: W, height: H } = await sharp(s.file).metadata();
  const layers = [{ input: labelSvg(W, title, sub, accent), left: 0, top: 0 }, { input: s.file, left: 0, top: LABEL }];
  const boxes = annotate ? s.crossings.map((c) => ({ x: (c.x - s.offX) * DSF, y: (c.atY - c.overlapPx / 2 - s.offY) * DSF, h: c.overlapPx * DSF })).filter((b) => b.x > 0 && b.x < W) : [];
  if (boxes.length) layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${boxes.map((b) => `<rect x="${b.x - 10}" y="${Math.max(2, b.y)}" width="20" height="${Math.max(8, b.h)}" rx="5" fill="none" stroke="#ff4d4f" stroke-width="4"/>`).join('')}</svg>`), left: 0, top: LABEL });
  return { buf: await sharp({ create: { width: W, height: H + LABEL, channels: 4, background: '#0a0a0a' } }).composite(layers).png().toBuffer(), boxed: boxes.length };
}
async function join(buffers, dir, out, scale = 1) {
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));
  const GAP = 16;
  const W = dir === 'h' ? metas.reduce((a, m) => a + m.width, 0) + GAP * (buffers.length - 1) : Math.max(...metas.map((m) => m.width));
  const H = dir === 'h' ? Math.max(...metas.map((m) => m.height)) : metas.reduce((a, m) => a + m.height, 0) + GAP * (buffers.length - 1);
  let pos = 0;
  const layers = buffers.map((b, i) => { const l = dir === 'h' ? { input: b, left: pos, top: 0 } : { input: b, left: 0, top: pos }; pos += (dir === 'h' ? metas[i].width : metas[i].height) + GAP; return l; });
  let buf = await sharp({ create: { width: W, height: H, channels: 4, background: '#3a3a3a' } }).composite(layers).png().toBuffer();
  if (scale !== 1) buf = await sharp(buf).resize(Math.round(W * scale)).png().toBuffer();
  fs.writeFileSync(out, buf);
  const m = await sharp(buf).metadata();
  console.log('composite', out, `${m.width}x${m.height}`, `${Math.round(buf.length / 1024)}KB`);
}
const s = {};
for (const arm of ['head2', 'head3']) {
  s[`skip390-${arm}`] = await shot(arm, 'r3SKIP', 'c1', 390, `f-skip-390-${arm}`);
  s[`skip700-${arm}`] = await shot(arm, 'r3SKIP', 'c1', 700, `f-skip-700-${arm}`);
  s[`dag390-${arm}`] = await shot(arm, 'r2DAG', 'compare-findings', 390, `f-dag-390-${arm}`);
}
const H2 = '#e5534b', H3 = '#3fb950';
const n = (k) => s[k].crossings.length;
{
  const a = await panel(s['skip390-head2'], '5f70a13 (previous head) · 390px', `${n('skip390-head2')} lane/step overlaps (visible ones boxed)`, H2, true);
  const b = await panel(s['skip390-head3'], 'd91a0f7e (this head) · 390px', `${n('skip390-head3')} overlaps · verticals on gutter centres`, H3, false);
  console.log('fig1 boxed', a.boxed);
  await join([a.buf, b.buf], 'h', `${COMP}/fig1-skip-390.png`);
}
{
  const a = await panel(s['dag390-head2'], '5f70a13 (previous head) · 390px', `lane 3->5 rises through step 4 (boxed)`, H2, true);
  const b = await panel(s['dag390-head3'], 'd91a0f7e (this head) · 390px', `${n('dag390-head3')} overlaps · lane in the 256-274 gutter`, H3, false);
  console.log('fig2 boxed', a.boxed);
  await join([a.buf, b.buf], 'h', `${COMP}/fig2-dag-390.png`);
}
{
  const a = await panel(s['skip700-head2'], '5f70a13 (previous head) · 700px, 32px gutter', 'no overlaps, but every vertical sits 12px off-centre, 4px from the next step', H2, false);
  const b = await panel(s['skip700-head3'], 'd91a0f7e (this head) · 700px, 32px gutter', 'every vertical on its gutter centre line', H3, false);
  await join([a.buf, b.buf], 'v', `${COMP}/fig3-skip-700.png`, 0.8);
}
fs.writeFileSync(`${R3DIR}/out/figs3-facts.json`, JSON.stringify(s, null, 2));
await browser.close();
