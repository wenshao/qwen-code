// PR 10938 A/B capture. Both arms render the SAME live daemon session at the
// same moment: head = daemon-served PR bundle, base = merge-base bundle via proxy.
// usage: node capture.mjs [scenario...]   (cockpit inspector dialog narrow big teeth)
import fs from 'node:fs';
import { launch, openPage, gotoSession, sleep, H, FIGS, writeJson, sid } from './lib2.mjs';


const DAG = sid('r2DAG');
const BIG = sid('r2BIG');
const want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['cockpit', 'inspector', 'dialog', 'narrow', 'big', 'teeth']);
const facts = {};
const noise = (p) => p.includes('Conversations') || p.includes('Failed to load resource');
const browser = await launch();

// ---------- in-page helpers (serialised into page.evaluate) ----------
const NODE_FACTS = () => {
  const px = (v) => Number.parseFloat(v) || 0;
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m);
    return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
  };
  const root = document.querySelector('[data-plan-node-id]')?.closest('[class*="dagCanvas"]');
  const cs = root ? getComputedStyle(root) : null;
  return {
    edges: document.querySelectorAll('[data-plan-edge]').length,
    canvas: cs && {
      paddingBottom: cs.paddingBottom,
      laneHeightVar: cs.getPropertyValue('--plan-edge-lane-height').trim(),
      lanesVar: cs.getPropertyValue('--plan-edge-lanes').trim(),
      gap: cs.columnGap,
    },
    nodes: [...document.querySelectorAll('[data-plan-node-id]')].map((btn) => {
      const art = btn.closest('article');
      const s = getComputedStyle(art);
      const after = getComputedStyle(art, '::after');
      const before = getComputedStyle(art, '::before');
      const bg = s.backgroundColor;
      const glyph = art.querySelector('i');
      const dep = art.querySelector('[class*="dependencies"]');
      return {
        id: btn.getAttribute('data-plan-node-id'),
        status: art.getAttribute('data-status'),
        attention: art.getAttribute('data-attention'),
        selected: art.getAttribute('data-selected'),
        face: btn.innerText.replace(/\n+/g, ' | '),
        borderLeft: `${s.borderLeftWidth} ${s.borderLeftColor}`,
        borderTop: `${s.borderTopWidth} ${s.borderTopColor}`,
        ruleContrastVsCanvas: px(s.borderLeftWidth) >= 3 && rgb(s.borderLeftColor)[3] !== 0 ? contrast(s.borderLeftColor, getComputedStyle(document.body).backgroundColor) : null,
        nodeBg: bg,
        glyphColor: glyph ? getComputedStyle(glyph).color : null,
        inputPort: before.display !== 'none' && !['none', 'normal'].includes(before.content) ? `${before.display} ${before.borderTopColor}` : 'none',
        outputPort: after.display !== 'none' && !['none', 'normal'].includes(after.content) ? `${after.display} ${after.borderTopColor}` : 'none',
        dependsRow: dep ? dep.innerText.replace(/\n+/g, ' | ') : null,
        width: Math.round(art.getBoundingClientRect().width),
      };
    }),
  };
};

async function page(arm, opts = {}) {
  const p = await openPage(browser, { theme: opts.theme || 'dark', width: opts.width || 1440, height: opts.height || 900, dsf: opts.dsf || 1 });
  p.arm = arm;
  return p;
}


async function openPlanDialog(pg) {
  const toggle = pg.locator('button[aria-label="Toggle environment information"]');
  await toggle.waitFor({ timeout: 20000 });
  await sleep(800);
  await toggle.click();
  const panel = pg.locator('[data-testid="environment-panel"]');
  await panel.waitFor({ timeout: 15000 });
  // Subagents section row -> openEnvironmentTask -> openTasksPanel (the Plan & tasks dialog).
  const row = panel.locator('button', { hasText: 'Profile slow suites' }).first();
  await row.waitFor({ timeout: 15000 });
  await row.click();
  const dlg = pg.locator('[role="dialog"]');
  await dlg.locator('[data-plan-node-id]').first().waitFor({ timeout: 20000 });
  await sleep(1200);
  return dlg;
}

// ---------- S1: cockpit ----------
if (want.has('cockpit')) {
  facts.cockpit = {};
  for (const theme of ['dark', 'light']) {
    for (const arm of ['head', 'base']) {
      const { page: pg, problems, context } = await page(arm, { theme });
      await gotoSession(pg, arm, DAG, { theme, view: 'cockpit' });
      await pg.locator('[data-plan-node-id]').first().waitFor({ timeout: 30000 });
      await sleep(2500);
      const f = await pg.evaluate(NODE_FACTS);
      await pg.locator('[data-testid="session-workflow-cockpit"]').screenshot({ path: `${FIGS}/cockpit-${theme}-${arm}.png` });
      if (theme === 'dark') {
        if (!(await pg.locator('[data-testid="workflow-step-detail"]').count())) await pg.locator('[data-testid="open-workflow"]').click();
        await pg.locator('[data-testid="workflow-step-detail"]').waitFor({ timeout: 15000 }).catch(() => {});
        await sleep(500);
        const det = pg.locator('[data-testid="workflow-canvas-detail"]');
        if (await det.count()) await det.screenshot({ path: `${FIGS}/cockpit-detail-${arm}.png` });
        f.detail = await pg.locator('[data-testid="workflow-step-detail"]').innerText().catch(() => null);
        f.dependencyLinks = await pg.locator('[data-testid^="workflow-dependency-"]').allInnerTexts();
        // Follow the edge downstream, then upstream, by clicking references.
        if (f.dependencyLinks.length) {
          const title = () => pg.locator('[data-testid="workflow-step-detail"] h3, [data-testid="workflow-step-detail"] strong').first().innerText();
          const sel = () => pg.evaluate(() => document.querySelector('article[data-selected="true"] [data-plan-node-id]')?.getAttribute('data-plan-node-id'));
          const nav = [{ before: await title(), selectedNode: await sel() }];
          await pg.locator('[data-testid="workflow-dependency-write-summary"]').click();
          await sleep(600);
          nav.push({ clicked: 'workflow-dependency-write-summary', title: await title(), selectedNode: await sel(), links: await pg.locator('[data-testid^="workflow-dependency-"]').allInnerTexts(), focusOnBody: await pg.evaluate(() => document.activeElement === document.body) });
          await pg.locator('[data-testid="workflow-dependency-compare-findings"]').click();
          await sleep(600);
          nav.push({ clicked: 'workflow-dependency-compare-findings', title: await title(), selectedNode: await sel(), links: await pg.locator('[data-testid^="workflow-dependency-"]').allInnerTexts() });
          f.navigation = nav;
          // Selected blocked node: the 3px rule must not repaint in the ring tone.
          f.selectedBlocked = (await pg.evaluate(NODE_FACTS)).nodes.find((n) => n.id === 'compare-findings');
          await det.screenshot({ path: `${FIGS}/cockpit-detail-${arm}-after-nav.png` });
        } else {
          // Base: select the same blocked node through the graph for the rule comparison.
          await pg.locator('[data-plan-node-id="compare-findings"]').click();
          await sleep(600);
          f.selectedBlocked = (await pg.evaluate(NODE_FACTS)).nodes.find((n) => n.id === 'compare-findings');
        }
      }
      f.problems = problems.filter((p) => !noise(p));
      facts.cockpit[`${theme}-${arm}`] = f;
      console.log('cockpit', theme, arm, 'edges', f.edges, 'problems', f.problems.length);
      await context.close();
    }
  }
  writeJson('facts-cockpit.json', facts.cockpit);
}

// ---------- S2: artifact-panel inspector (activity + show-all) ----------
if (want.has('inspector')) {
  facts.inspector = {};
  const ACT = () => {
    const det = [...document.querySelectorAll('details')].find((d) => d.querySelector('summary')?.innerText.startsWith('Recent Agent activity'));
    const list = det?.querySelector('summary + div');
    const btn = document.querySelector('[data-testid="workflow-activity-show-all"]');
    const r = btn?.getBoundingClientRect();
    const cs = btn && getComputedStyle(btn);
    return {
      summary: det?.querySelector('summary')?.innerText.replace(/\n/g, ' '),
      rows: list ? [...list.children].filter((c) => c !== btn && c.tagName !== 'P').length : null,
      listWidth: list ? Math.round(list.getBoundingClientRect().width) : null,
      showAll: btn && { text: btn.innerText, width: Math.round(r.width), height: Math.round(r.height), display: cs.display, gridTemplateColumns: cs.gridTemplateColumns, padding: cs.padding, lineHeight: cs.lineHeight },
      metricsRows: [...document.querySelectorAll('[data-testid="workflow-inspector"] small')].filter((s) => /tool calls/.test(s.innerText)).map((s) => ({ text: s.innerText.replace(/\n/g, ' ‖ '), spans: s.querySelectorAll('span').length, h: Math.round(s.getBoundingClientRect().height) })).slice(0, 3),
      sectionLabel: (() => {
        const el = [...document.querySelectorAll('[data-testid="workflow-inspector"] span')].find((s) => /^(Selected step|SELECTED STEP)$/i.test(s.innerText.trim()));
        return el && { text: el.innerText, transform: getComputedStyle(el).textTransform, weight: getComputedStyle(el).fontWeight, letterSpacing: getComputedStyle(el).letterSpacing };
      })(),
      summaryCount: (() => {
        const el = document.querySelector('[data-testid="workflow-inspector"] [class*="summaryCount"]');
        return el && { text: el.innerText, bg: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius };
      })(),
    };
  };
  for (const arm of ['head', 'base']) {
    const { page: pg, problems, context } = await page(arm, { dsf: 1 });
    await gotoSession(pg, arm, DAG, { theme: 'dark' });
    await pg.locator('[data-testid="open-workflow"]').click();
    const insp = pg.locator('[data-testid="workflow-inspector"]');
    await insp.waitFor({ timeout: 20000 });
    await sleep(1500);
    const f = { before: await pg.evaluate(ACT) };
    const actDetails = pg.locator('details', { hasText: 'Recent Agent activity' });
    await actDetails.scrollIntoViewIfNeeded();
    await actDetails.screenshot({ path: `${FIGS}/inspector-activity-${arm}.png` });
    await pg.locator('[data-testid="workflow-step-detail"]').screenshot({ path: `${FIGS}/inspector-detail-${arm}.png` });
    if (await pg.locator('[data-testid="workflow-activity-show-all"]').count()) {
      await pg.locator('[data-testid="workflow-activity-show-all"]').click();
      await sleep(500);
      f.after = await pg.evaluate(ACT);
      f.focusAfterShowAll = await pg.evaluate(() => document.activeElement?.tagName + (document.activeElement === document.body ? ' (body)' : ''));
      await actDetails.screenshot({ path: `${FIGS}/inspector-activity-${arm}-expanded.png` });
    }
    await insp.screenshot({ path: `${FIGS}/inspector-${arm}.png` });
    f.problems = problems.filter((p) => !noise(p));
    facts.inspector[arm] = f;
    console.log('inspector', arm, JSON.stringify(f.before.showAll), 'rows', f.before.rows, '->', f.after?.rows);
    await context.close();
  }
  writeJson('facts-inspector.json', facts.inspector);
}

// ---------- S3: Plan & Review card graph (its own step-details panel) ----------
// A second, unapproved session: the approval card renders PlanExecutionView with
// showStepDetails on, which is the panel whose references became controls.
if (want.has('dialog')) {
  facts.dialog = {};
  const REVIEW = sid('r2REVIEW');
  for (const arm of ['head', 'base']) {
    const { page: pg, problems, context } = await page(arm, { height: 1000 });
    await gotoSession(pg, arm, REVIEW, { theme: 'dark' });
    const first = pg.locator('[data-plan-node-id="compare-findings"]');
    await first.waitFor({ timeout: 30000 });
    await sleep(1500);
    const f = {};
    f.faces = (await pg.evaluate(NODE_FACTS)).nodes.map((n) => ({ id: n.id, face: n.face, dependsRow: n.dependsRow, inputPort: n.inputPort, outputPort: n.outputPort, borderLeft: n.borderLeft }));
    await first.click();
    await sleep(700);
    const panel = pg.locator('[id^="plan-step-details-"]');
    await panel.scrollIntoViewIfNeeded().catch(() => {});
    f.panelText = await panel.innerText().catch(() => null);
    f.panelLinks = await panel.locator('[data-plan-dependency]').evaluateAll((bs) => bs.map((b) => ({ id: b.getAttribute('data-plan-dependency'), text: b.innerText.replace(/\n/g, ' '), tag: b.tagName, interactive: b.hasAttribute('data-plan-interactive') })));
    await sleep(300);
    const box = await pg.evaluate(() => {
      const g = document.querySelector('[data-plan-node-id]').closest('[class*="dagCanvas"]').getBoundingClientRect();
      const p = document.querySelector('[id^="plan-step-details-"]')?.getBoundingClientRect();
      const top = Math.max(0, g.top - 40);
      const bottom = Math.min(innerHeight, Math.max(g.bottom, p ? p.bottom : g.bottom) + 10);
      return { x: Math.max(0, g.left - 20), y: top, width: Math.min(innerWidth, g.width + 40), height: bottom - top };
    });
    await pg.screenshot({ path: `${FIGS}/review-panel-${arm}.png`, clip: box });
    if (f.panelLinks.length) {
      await panel.locator('[data-plan-dependency="survey-api"]').click();
      await sleep(700);
      f.afterUpstreamClick = await pg.evaluate(() => ({
        selected: document.querySelector('article[data-selected="true"] [data-plan-node-id]')?.getAttribute('data-plan-node-id'),
        panel: document.querySelector('[id^="plan-step-details-"]')?.innerText.replace(/\n+/g, ' | ').slice(0, 200),
        focusOnBody: document.activeElement === document.body,
      }));
      await pg.locator('[id^="plan-step-details-"] [data-plan-dependency="compare-findings"]').click();
      await sleep(700);
      f.afterDownstreamClick = await pg.evaluate(() => ({
        selected: document.querySelector('article[data-selected="true"] [data-plan-node-id]')?.getAttribute('data-plan-node-id'),
      }));
    }
    f.problems = problems.filter((p) => !noise(p));
    facts.dialog[arm] = f;
    console.log('review-card', arm, 'links', f.panelLinks.length, JSON.stringify(f.afterUpstreamClick || null), JSON.stringify(f.afterDownstreamClick || null));
    await context.close();
  }
  writeJson('facts-dialog.json', facts.dialog);
}

// ---------- S4: narrow viewports (cockpit lanes + dialog gutter) ----------
if (want.has('narrow')) {
  facts.narrow = {};
  const LANES = () => {
    const canvas = document.querySelector('[data-plan-node-id]')?.closest('[class*="dagCanvas"]');
    const layers = [...(canvas?.children || [])].filter((c) => c.querySelector?.('[data-plan-node-id]'));
    const scroller = canvas?.parentElement;
    const cs = canvas && getComputedStyle(canvas);
    return {
      layerWidths: layers.map((l) => Math.round(l.getBoundingClientRect().width)),
      gap: cs?.columnGap,
      padding: cs && `${cs.paddingLeft} ${cs.paddingRight}`,
      canvasWidth: canvas && Math.round(canvas.getBoundingClientRect().width),
      scroller: scroller && { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, overflowsX: scroller.scrollWidth > scroller.clientWidth },
      viewport: innerWidth,
    };
  };
  for (const width of [1440, 700, 430, 414, 390]) {
    for (const arm of ['head', 'base']) {
      const { page: pg, problems, context } = await page(arm, { width, height: 900 });
      await gotoSession(pg, arm, DAG, { theme: 'dark', view: 'cockpit' });
      await pg.locator('[data-plan-node-id]').first().waitFor({ timeout: 30000 });
      await sleep(2000);
      const f = await pg.evaluate(LANES);
      if (width === 700 || width === 390) await pg.screenshot({ path: `${FIGS}/narrow-${width}-${arm}.png` });
      f.problems = problems.filter((p) => !noise(p));
      facts.narrow[`${width}-${arm}`] = f;
      console.log('narrow', width, arm, JSON.stringify(f.layerWidths), f.gap, JSON.stringify(f.scroller));
      await context.close();
    }
  }
  writeJson('facts-narrow.json', facts.narrow);
}

// ---------- S5: >500 dependencies ----------
if (want.has('big')) {
  facts.big = {};
  for (const arm of ['head', 'base']) {
    const { page: pg, problems, context } = await page(arm, { width: 1440, height: 1000 });
    await gotoSession(pg, arm, BIG, { theme: 'dark', view: 'cockpit' });
    await pg.locator('[data-plan-node-id]').first().waitFor({ timeout: 30000 });
    await sleep(2500);
    const nf = await pg.evaluate(NODE_FACTS);
    const body = await pg.locator('body').innerText();
    const f = {
      nodes: nf.nodes.length,
      edges: nf.edges,
      notice: (body.match(/Too many dependencies to draw[^\n]*/) || [null])[0],
      leavesWithDependsRow: nf.nodes.filter((n) => n.id.startsWith('leaf-') && n.dependsRow).length,
      leaf1Row: nf.nodes.find((n) => n.id === 'leaf-1')?.dependsRow?.slice(0, 160),
      leaf1Height: await pg.locator('[data-plan-node-id="leaf-1"]').evaluate((b) => Math.round(b.closest('article').getBoundingClientRect().height)),
    };
    await pg.locator('[data-plan-node-id="leaf-1"]').scrollIntoViewIfNeeded();
    await sleep(400);
    await pg.screenshot({ path: `${FIGS}/big-${arm}.png` });
    f.problems = problems.filter((p) => !noise(p));
    facts.big[arm] = f;
    console.log('big', arm, JSON.stringify(f).slice(0, 400));
    await context.close();
  }
  writeJson('facts-big.json', facts.big);
}

// ---------- S6: in-browser teeth: delete the PR's rules from the CSSOM ----------
if (want.has('teeth')) {
  facts.teeth = {};
  const { page: pg, context } = await page('head');
  await gotoSession(pg, 'head', DAG, { theme: 'dark' });
  await pg.locator('[data-testid="open-workflow"]').click();
  await pg.locator('[data-testid="workflow-activity-show-all"]').waitFor({ timeout: 20000 });
  await sleep(1000);
  const measure = () => pg.locator('[data-testid="workflow-activity-show-all"]').evaluate((b) => {
    const r = b.getBoundingClientRect();
    const label = document.createRange();
    label.selectNodeContents(b);
    return { width: Math.round(r.width), height: Math.round(r.height), textLines: label.getClientRects().length, display: getComputedStyle(b).display, cols: getComputedStyle(b).gridTemplateColumns };
  });
  facts.teeth.showAllWithRule = await measure();
  facts.teeth.removedRules = await pg.evaluate(() => {
    const removed = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        if (rules[i].selectorText?.includes('showAllActivity')) {
          removed.push(rules[i].selectorText);
          sheet.deleteRule(i);
        }
      }
    }
    return removed;
  });
  await sleep(300);
  facts.teeth.showAllWithoutRule = await measure();
  await pg.locator('details', { hasText: 'Recent Agent activity' }).screenshot({ path: `${FIGS}/teeth-showall-rule-removed.png` });
  await context.close();

  // Selected blocked node with the `border-left-color: var(--node-rule)` pin removed.
  const t2 = await page('head');
  await gotoSession(t2.page, 'head', DAG, { theme: 'dark', view: 'cockpit' });
  await t2.page.locator('[data-plan-node-id]').first().waitFor({ timeout: 30000 });
  await sleep(1500);
  await t2.page.locator('[data-plan-node-id="compare-findings"]').click();
  await sleep(600);
  const leftOf = () => t2.page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('[data-plan-node-id="compare-findings"]').closest('article'));
    return `${s.borderLeftWidth} ${s.borderLeftColor}`;
  });
  facts.teeth.selectedBlockedWithPin = await leftOf();
  facts.teeth.removedPin = await t2.page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.selectorText?.includes("[data-selected='true']") || rule.selectorText?.includes('[data-selected="true"]')) {
          if (rule.style?.getPropertyValue('border-left-color')) {
            rule.style.setProperty('border-left-color', 'var(--node-ring)');
            return rule.selectorText;
          }
        }
      }
    }
    return null;
  });
  await sleep(300);
  facts.teeth.selectedBlockedWithoutPin = await leftOf();
  await t2.context.close();
  console.log('teeth', JSON.stringify(facts.teeth));
  writeJson('facts-teeth.json', facts.teeth);
}

await browser.close();
