// PR #12652 collapsed-rail probe: drives a real `qwen serve` Web Shell,
// collapses the sidebar with the real toggle, and measures the rail geometry.
// Env:
//   PW_FROM   path whose node_modules resolves `playwright`
//   ENGINE    chromium | firefox | webkit
//   CHANNEL   optional (chrome) for a branded browser
//   KEEP_SB   "1" = drop Playwright's default --hide-scrollbars (chromium)
//   HEADED    "1" = headed
//   ARMS      JSON [{name,url}]
//   VIEWPORTS JSON [{name,width,height}]
//   OUT       output dir
//   TAG       label for this engine configuration
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(path.join(process.env.PW_FROM, 'package.json'));
const pw = require('playwright');

const engine = process.env.ENGINE || 'chromium';
const tag = process.env.TAG || engine;
const out = process.env.OUT;
const arms = JSON.parse(process.env.ARMS);
const viewports = JSON.parse(
  process.env.VIEWPORTS ||
    '[{"name":"tall","width":1280,"height":900},{"name":"short","width":1280,"height":560}]',
);
fs.mkdirSync(out, { recursive: true });

const launch = { headless: process.env.HEADED !== '1' };
if (process.env.CHANNEL) launch.channel = process.env.CHANNEL;
if (engine === 'chromium' && process.env.KEEP_SB === '1') {
  launch.ignoreDefaultArgs = ['--hide-scrollbars'];
}
const browser = process.env.CDP
  ? await pw.chromium.connectOverCDP(process.env.CDP)
  : await pw[engine].launch(launch);
const version = browser.version();

async function measure(page) {
  return page.evaluate(() => {
    const aside = document.querySelector('aside');
    const ar = aside.getBoundingClientRect();
    const kids = [...aside.children];
    const body = kids.find((el) => getComputedStyle(el).overflowY === 'auto');
    const bs = getComputedStyle(body);
    const br = body.getBoundingClientRect();
    const region = (el) => {
      if (body.contains(el)) return 'body';
      const top = kids.find((k) => k.contains(el));
      if (!top) return 'other';
      if (top.querySelector('[aria-label="New task"]')) return 'newTask';
      if (getComputedStyle(top).position === 'absolute') return 'footer';
      return 'top';
    };
    const icons = [];
    for (const svg of aside.querySelectorAll('svg')) {
      const r = svg.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const btn = svg.closest('button');
      const label =
        btn?.getAttribute('aria-label') ||
        (svg.closest('[aria-hidden="true"]') && !btn ? 'brand-logo' : '?');
      const reg = region(svg);
      const visibleInBody =
        reg !== 'body' || (r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5);
      icons.push({
        label,
        region: reg,
        cx: +(r.left + r.width / 2).toFixed(2),
        top: +r.top.toFixed(1),
        visible: visibleInBody,
        btnLeft: btn ? +btn.getBoundingClientRect().left.toFixed(2) : null,
        btnWidth: btn ? +btn.getBoundingClientRect().width.toFixed(2) : null,
      });
    }
    const nt = icons.find((i) => i.label === 'New task');
    for (const i of icons) i.dx = nt ? +(i.cx - nt.cx).toFixed(2) : null;
    return {
      asideWidth: +ar.width.toFixed(2),
      body: {
        offsetWidth: body.offsetWidth,
        clientWidth: body.clientWidth,
        reserved: body.offsetWidth - body.clientWidth,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        overflows: body.scrollHeight > body.clientHeight,
        scrollTop: body.scrollTop,
        scrollbarGutter: bs.scrollbarGutter,
        scrollbarWidth: bs.scrollbarWidth,
        rect: { top: br.top, bottom: br.bottom, left: br.left, right: br.right },
      },
      icons,
      maxAbsDxBody: Math.max(
        0,
        ...icons.filter((i) => i.region === 'body').map((i) => Math.abs(i.dx)),
      ),
      maxAbsDxAll: Math.max(0, ...icons.map((i) => Math.abs(i.dx))),
    };
  });
}

async function openArm(arm, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.goto(`${arm.url}/?language=en`, { waitUntil: 'load' });
  await page.waitForSelector('aside [aria-label="New task"]', {
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  return { context, page };
}

const results = { tag, engine, version, launch, arms: {} };
for (const arm of arms) {
  results.arms[arm.name] = {};
  for (const vp of viewports) {
    const { context, page } = await openArm(arm, vp);
    const rec = {};
    rec.expanded = await measure(page);
    await page.screenshot({
      path: path.join(out, `${tag}-${arm.name}-${vp.name}-expanded.png`),
      clip: { x: 0, y: 0, width: 300, height: vp.height },
    });
    // Collapse with the real footer toggle.
    await page.locator('aside button[aria-label="Collapse"]').click();
    await page.waitForFunction(
      () => document.querySelector('aside').getBoundingClientRect().width < 60,
    );
    await page.waitForTimeout(600);
    await page.mouse.move(vp.width - 10, vp.height / 2);
    await page.waitForTimeout(300);
    rec.collapsed = await measure(page);
    await page.screenshot({
      path: path.join(out, `${tag}-${arm.name}-${vp.name}-collapsed.png`),
      clip: { x: 0, y: 0, width: 56, height: vp.height },
    });
    if (rec.collapsed.body.overflows) {
      const b = rec.collapsed.body.rect;
      await page.mouse.move(28, (b.top + b.bottom) / 2);
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(400);
      rec.collapsedScrolled = await measure(page);
      await page.mouse.move(vp.width - 10, vp.height / 2);
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(
          out,
          `${tag}-${arm.name}-${vp.name}-collapsed-scrolled.png`,
        ),
        clip: { x: 0, y: 0, width: 56, height: vp.height },
      });
    }
    // Expand again: the expanded rule set must be untouched.
    await page.locator('aside button[aria-label="Expand"]').click();
    await page.waitForFunction(
      () => document.querySelector('aside').getBoundingClientRect().width > 100,
    );
    await page.waitForTimeout(600);
    rec.reExpanded = await measure(page);
    await page.screenshot({
      path: path.join(out, `${tag}-${arm.name}-${vp.name}-reexpanded.png`),
      clip: { x: 0, y: 0, width: 300, height: vp.height },
    });
    results.arms[arm.name][vp.name] = rec;
    await context.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(out, `${tag}.json`), JSON.stringify(results, null, 2));
for (const [arm, vps] of Object.entries(results.arms)) {
  for (const [vp, r] of Object.entries(vps)) {
    const c = r.collapsed;
    const s = r.collapsedScrolled;
    console.log(
      `PROBE ${tag} ${version} arm=${arm} vp=${vp} collapsed: reserved=${c.body.reserved} overflow=${c.body.overflows} gutter=${c.body.scrollbarGutter} sbw=${c.body.scrollbarWidth} maxDxBody=${c.maxAbsDxBody}` +
        (s ? ` | scrolled: scrollTop=${s.body.scrollTop} reserved=${s.body.reserved} maxDxBody=${s.maxAbsDxBody}` : '') +
        ` | expanded reserved=${r.expanded.body.reserved} reExpanded reserved=${r.reExpanded.body.reserved}`,
    );
  }
}
