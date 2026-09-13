// Round-2 decisive probe for fix commit 4860e0a7e6, across three arms rendering
// the SAME live daemon sessions: base (bc7a186), revert (head minus the fix), head.
// usage: node fixes.mjs [edges] [a11y] [zh]
import { createRequire } from 'node:module';
import { launch, openPage, gotoSession, sleep, FIGS, writeJson, sid, noise } from './lib2.mjs';

const require = createRequire('/var/tmp/pr10938-wt/node_modules/');
const sharp = require('sharp');
const DAG = sid('r2DAG');
const REVIEW = sid('r2REVIEW');
const BIG = sid('r2BIG');
const ARMS3 = (process.env.ARMS || 'base,revert,head').split(',');
const OUTSUFFIX = process.env.OUTSUFFIX || '';
const want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['edges', 'a11y', 'zh']);
const browser = await launch();

// ---------------- edges: end tangents + lane segments over nodes ----------------
const EDGE_FACTS = () => {
  const paths = [...document.querySelectorAll('[data-plan-edge]')];
  const svg = paths[0]?.ownerSVGElement;
  const canvas = document.querySelector('[data-plan-node-id]')?.closest('[class*="dagCanvas"]');
  const sr = (svg || canvas).getBoundingClientRect();
  const nodes = [...document.querySelectorAll('[data-plan-node-id]')].map((b) => {
    const r = b.closest('article').getBoundingClientRect();
    return { id: b.getAttribute('data-plan-node-id'), l: r.left - sr.left, r: r.right - sr.left, t: r.top - sr.top, b: r.bottom - sr.top };
  });
  const parse = (d) => {
    const tok = d.match(/[MCQHVLZ]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    let i = 0, cmd = '', cur = [0, 0], prevCtl = null, cmds = '', guard = 0;
    const verts = [];
    const num = () => Number(tok[i++]);
    while (i < tok.length && guard++ < 500) {
      if (/[A-Z]/.test(tok[i])) { cmd = tok[i++]; cmds += cmd; }
      if (cmd === 'M') { cur = [num(), num()]; prevCtl = null; }
      else if (cmd === 'L') { prevCtl = cur; cur = [num(), num()]; }
      else if (cmd === 'C') { num(); num(); const c2 = [num(), num()]; prevCtl = c2; cur = [num(), num()]; }
      else if (cmd === 'Q') { const c1 = [num(), num()]; prevCtl = c1; cur = [num(), num()]; }
      else if (cmd === 'H') { prevCtl = cur; cur = [num(), cur[1]]; }
      else if (cmd === 'V') { const y = num(); verts.push({ x: cur[0], y1: cur[1], y2: y }); prevCtl = cur; cur = [cur[0], y]; }
      else i++;
    }
    return { cmds, end: cur, prevCtl, verts };
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const firstArticle = document.querySelector('[data-plan-node-id]')?.closest('article');
  return {
    viewport: innerWidth,
    gap: canvas && getComputedStyle(canvas).columnGap,
    svgPaintsBeforeNodes: !!(svg && firstArticle && svg.compareDocumentPosition(firstArticle) & Node.DOCUMENT_POSITION_FOLLOWING),
    svgZ: svg && getComputedStyle(svg).zIndex,
    articlePosition: firstArticle && `${getComputedStyle(firstArticle).position} z=${getComputedStyle(firstArticle).zIndex}`,
    svgOrigin: [r1(sr.left), r1(sr.top)],
    edges: paths.map((p) => {
      const { cmds, end, prevCtl, verts } = parse(p.getAttribute('d'));
      const from = p.getAttribute('data-from');
      const to = p.getAttribute('data-to');
      const tan = prevCtl ? [r1(end[0] - prevCtl[0]), r1(end[1] - prevCtl[1])] : null;
      const dir = !tan ? 'n/a' : tan[0] === 0 && tan[1] === 0 ? 'degenerate' : Math.abs(tan[0]) >= Math.abs(tan[1]) ? (tan[0] > 0 ? 'right' : 'LEFT') : tan[1] > 0 ? 'down' : 'up';
      const crossings = [];
      for (const v of verts) {
        const y1 = Math.min(v.y1, v.y2), y2 = Math.max(v.y1, v.y2);
        for (const n of nodes) {
          if (n.id === from || n.id === to) continue;
          if (v.x > n.l && v.x < n.r && y2 > n.t && y1 < n.b) {
            crossings.push({ node: n.id, x: r1(v.x), insideLeftEdgeBy: r1(v.x - n.l), overlapPx: r1(Math.min(y2, n.b) - Math.max(y1, n.t)), atY: r1((Math.max(y1, n.t) + Math.min(y2, n.b)) / 2) });
          }
        }
      }
      return { from, to, kind: cmds.includes('V') ? 'lane' : 'adjacent', cmds, d: p.getAttribute('d'), end: end.map(r1), tangent: tan, arrowhead: dir, verts: verts.map((v) => ({ x: r1(v.x), y1: r1(v.y1), y2: r1(v.y2) })), crossings };
    }),
    nodes: nodes.map((n) => ({ ...n, l: r1(n.l), r: r1(n.r), t: r1(n.t), b: r1(n.b) })),
  };
};

if (want.has('edges')) {
  const facts = {};
  for (const width of [1440, 700, 430, 390]) {
    for (const arm of ARMS3) {
      const { page: pg, problems, context } = await openPage(browser, { width, height: 900, dsf: width <= 700 ? 4 : 2 });
      await gotoSession(pg, arm, DAG, { theme: 'dark', view: 'cockpit' });
      await pg.locator('[data-plan-node-id="compare-findings"]').first().waitFor({ timeout: 30000 });
      await pg.locator('[data-plan-node-id="compare-findings"]').first().scrollIntoViewIfNeeded();
      await sleep(2000);
      const f = await pg.evaluate(EDGE_FACTS);
      if (width === 390 || width === 700) {
        const [ox, oy] = f.svgOrigin;
        // Arrowhead crop: the adjacent edge survey-api -> compare-findings.
        const e = f.edges.find((x) => x.from === 'survey-api' && x.to === 'compare-findings');
        if (e) {
          await pg.screenshot({ path: `${FIGS}/arrow-${width}-${arm}.png`, clip: { x: ox + e.end[0] - 46, y: oy + e.end[1] - 22, width: 64, height: 44 } });
        }
        // Lane-edge segments that run through an intermediate node.
        const lane = f.edges.find((x) => x.kind === 'lane' && x.crossings.length);
        if (lane) {
          const c = lane.crossings[0];
          await pg.screenshot({ path: `${FIGS}/lane-crossing-${width}-${arm}.png`, clip: { x: Math.max(0, ox + c.x - 40), y: Math.max(0, oy + c.atY - 40), width: 80, height: 80 } });
        }
        const canvasBox = await pg.locator('[data-plan-node-id]').first().evaluate((b) => {
          const r = b.closest('[class*="dagCanvas"]').parentElement.getBoundingClientRect();
          return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth, r.width), height: Math.min(innerHeight - Math.max(0, r.top), r.height) };
        });
        await pg.screenshot({ path: `${FIGS}/graph-${width}-${arm}.png`, clip: canvasBox });
      }
      f.problems = problems.filter((p) => !noise(p));
      facts[`${width}-${arm}`] = f;
      console.log('edges', width, arm, f.gap, f.edges.map((x) => `${x.from}->${x.to}:${x.kind}:${JSON.stringify(x.tangent)}:${x.arrowhead}${x.crossings.length ? ' X' + JSON.stringify(x.crossings.map((c) => [c.node, c.insideLeftEdgeBy, c.overlapPx])) : ''}`).join(' | '), 'problems', f.problems.length);
      await context.close();
    }
  }
  writeJson(`fixes-edges${OUTSUFFIX}.json`, facts);
}

// ---------------- arrows: tight high-DPR crops of one arrowhead per arm ----------------
if (want.has('arrows')) {
  for (const width of [700, 390]) {
    for (const arm of ARMS3) {
      const { page: pg, context } = await openPage(browser, { width, height: 900, dsf: 8 });
      await gotoSession(pg, arm, DAG, { theme: 'dark', view: 'cockpit' });
      await pg.locator('[data-plan-node-id="compare-findings"]').first().waitFor({ timeout: 30000 });
      await pg.locator('[data-plan-node-id="compare-findings"]').first().scrollIntoViewIfNeeded();
      await sleep(2000);
      const f = await pg.evaluate(EDGE_FACTS);
      const [ox, oy] = f.svgOrigin;
      const e = f.edges.find((x) => x.from === 'read-tests' && x.to === 'compare-findings');
      await pg.screenshot({ path: `${FIGS}/arrowhead-${width}-${arm}.png`, clip: { x: ox + e.end[0] - 22, y: oy + e.end[1] - 12, width: 30, height: 24 } });
      console.log('arrowhead', width, arm, JSON.stringify(e.tangent), e.arrowhead, e.d);
      await context.close();
    }
  }
}

// ---------------- a11y: accessible names + "stated exactly once" ----------------
const NODE_A11Y = () => {
  const arts = [...document.querySelectorAll('[data-plan-node-id]')].map((b) => b.closest('article'));
  return {
    edgesDrawn: document.querySelectorAll('[data-plan-edge]').length,
    edgeLayerAriaHidden: document.querySelector('[data-plan-edge]')?.closest('svg')?.getAttribute('aria-hidden') ?? null,
    srSummaries: [...document.querySelectorAll('[class*="nodeDependencyText"]')].map((s) => {
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return { node: s.closest('button')?.getAttribute('data-plan-node-id'), text: s.textContent, box: `${Math.round(r.width)}x${Math.round(r.height)}`, clip: cs.clipPath !== 'none' ? cs.clipPath : cs.clip, position: cs.position, overflow: cs.overflow };
    }),
    visibleDependsRows: arts.filter((a) => a.querySelector('[class*="dependencies"]')).map((a) => a.querySelector('[data-plan-node-id]').getAttribute('data-plan-node-id')),
    nodeHeights: Object.fromEntries(arts.map((a) => [a.querySelector('[data-plan-node-id]').getAttribute('data-plan-node-id'), Math.round(a.getBoundingClientRect().height)])),
  };
};

async function pixelDiff(a, b) {
  const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return { sameSize: false, a: `${ra.info.width}x${ra.info.height}`, b: `${rb.info.width}x${rb.info.height}` };
  let diff = 0;
  for (let i = 0; i < ra.data.length; i += ra.info.channels) {
    if (ra.data[i] !== rb.data[i] || ra.data[i + 1] !== rb.data[i + 1] || ra.data[i + 2] !== rb.data[i + 2]) diff++;
  }
  return { sameSize: true, size: `${ra.info.width}x${ra.info.height}`, differingPixels: diff };
}

if (want.has('a11y')) {
  const facts = {};
  const shots = {};
  for (const arm of ARMS3) {
    const f = {};
    // (1) Plan & Review card: interactive graph, edges drawn, nothing selected.
    {
      const { page: pg, problems, context } = await openPage(browser, { width: 1440, height: 1000 });
      await gotoSession(pg, arm, REVIEW, { theme: 'dark' });
      const node = (id) => pg.locator(`[data-plan-node-id="${id}"]`).first();
      await node('compare-findings').waitFor({ timeout: 30000 });
      await sleep(1500);
      f.review = { names: {} };
      for (const id of ['survey-api', 'compare-findings', 'write-summary']) f.review.names[id] = await node(id).ariaSnapshot();
      Object.assign(f.review, await pg.evaluate(NODE_A11Y));
      shots[arm] = await pg.locator('[data-plan-node-id]').first().evaluateHandle((b) => b.closest('[class*="dagCanvas"]'));
      const buf = await shots[arm].screenshot({ path: `${FIGS}/review-graph-${arm}.png` });
      shots[arm] = buf;
      // Select a blocked node: the Step-details panel now also states it.
      await node('compare-findings').click();
      await sleep(700);
      f.review.selected = {
        name: await node('compare-findings').ariaSnapshot(),
        panel: await pg.locator('[id^="plan-step-details-"]').first().innerText().catch(() => null),
      };
      f.review.problems = problems.filter((p) => !noise(p));
      await context.close();
    }
    // (2) Cockpit: showStepDetails off -> the visible chip row states it; no sr-only copy.
    {
      const { page: pg, problems, context } = await openPage(browser, { width: 1440, height: 900 });
      await gotoSession(pg, arm, DAG, { theme: 'dark', view: 'cockpit' });
      await pg.locator('[data-plan-node-id="compare-findings"]').first().waitFor({ timeout: 30000 });
      await sleep(1500);
      f.cockpit = { name: await pg.locator('[data-plan-node-id="compare-findings"]').first().ariaSnapshot(), ...(await pg.evaluate(NODE_A11Y)) };
      f.cockpit.problems = problems.filter((p) => !noise(p));
      await context.close();
    }
    // (3) >500 dependencies: no edges -> visible rows on every leaf; no sr-only copy.
    if (!want.has('nobig')) {
      const { page: pg, problems, context } = await openPage(browser, { width: 1440, height: 1000 });
      await gotoSession(pg, arm, BIG, { theme: 'dark', view: 'cockpit' });
      await pg.locator('[data-plan-node-id="leaf-1"]').first().waitFor({ timeout: 30000 });
      await sleep(2000);
      const a = await pg.evaluate(NODE_A11Y);
      f.big = { edgesDrawn: a.edgesDrawn, srSummaries: a.srSummaries.length, visibleDependsRows: a.visibleDependsRows.length, leaf1Height: a.nodeHeights['leaf-1'] };
      f.big.problems = problems.filter((p) => !noise(p));
      await context.close();
    }
    facts[arm] = f;
    console.log('a11y', arm, JSON.stringify(f.review.names['compare-findings']), 'sr', f.review.srSummaries.length, 'cockpit sr', f.cockpit.srSummaries.length, 'rows', f.cockpit.visibleDependsRows.length, 'big', JSON.stringify(f.big));
  }
  facts.reviewGraphPixelDiff = { revertVsHead: await pixelDiff(shots.revert, shots.head), baseVsHead: await pixelDiff(shots.base, shots.head) };
  console.log('pixel diff', JSON.stringify(facts.reviewGraphPixelDiff));
  writeJson('fixes-a11y.json', facts);
}

// ---------------- zh-CN: the summary under the Chinese locale ----------------
if (want.has('zh')) {
  const facts = {};
  for (const arm of ['revert', 'head']) {
    const { page: pg, problems, context } = await openPage(browser, { width: 1440, height: 1000, init: { 'qwen-code-web-shell-language': process.env.ZH_VALUE || 'zh-CN' } });
    await gotoSession(pg, arm, REVIEW, { theme: 'dark' });
    await pg.locator('[data-plan-node-id="compare-findings"]').first().waitFor({ timeout: 30000 });
    await sleep(1500);
    facts[arm] = {
      htmlLang: await pg.evaluate(() => document.documentElement.lang),
      name: await pg.locator('[data-plan-node-id="compare-findings"]').first().ariaSnapshot(),
      problems: problems.filter((p) => !noise(p)),
    };
    console.log('zh', arm, JSON.stringify(facts[arm]));
    await context.close();
  }
  writeJson('fixes-zh.json', facts);
}

await browser.close();
