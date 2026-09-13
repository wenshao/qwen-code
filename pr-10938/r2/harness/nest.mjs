// R8-2 runtime probe. Session NEST: a background root agent linked to todo
// `nest-step` whose subagent launches a nested foreground agent; both stay live
// (the mock never answers the nested one). Compares, in ONE render, the node
// face's "N agents" with the agent rows the same node renders and with the
// overview strip's active-agent count, plus the daemon's task snapshot.
// usage: node nest.mjs [label] [arms...]
import fs from 'node:fs';
import { launch, openPage, gotoSession, sleep, FIGS, writeJson, sid, noise, R2 } from './lib2.mjs';

const label = process.argv[2] || 'r2NEST';
const arms = process.argv.slice(3).length ? process.argv.slice(3) : ['head', 'base'];
const NEST = sid(label);
const browser = await launch();
const facts = {};

const NODE = () => {
  const btn = document.querySelector('[data-plan-node-id="nest-step"]');
  const art = btn?.closest('article');
  if (!art) return null;
  let root = art;
  while (root && !root.querySelector('[class*="overviewStat"]')) root = root.parentElement;
  return {
    face: btn.innerText.replace(/\n+/g, ' | '),
    faceAgentCount: (btn.innerText.match(/\d+ agents?/) || [null])[0],
    renderedAgentRows: [...art.querySelectorAll('[class*="executionLabel"]')].map((e) => e.innerText.trim()),
    strip: root ? [...root.querySelectorAll('[class*="overviewStat"]')].map((s) => s.innerText.replace(/\n+/g, ' ')) : null,
    articleText: art.innerText.replace(/\n+/g, ' | ').slice(0, 400),
  };
};

for (const arm of arms) {
  for (const view of ['cockpit', 'chat']) {
    const { page: pg, problems, context } = await openPage(browser, { width: 1440, height: 1000 });
    const bodies = [];
    pg.on('response', async (r) => {
      if (r.request().method() !== 'GET') return;
      const ct = r.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      try {
        const text = await r.text();
        if (/parentAgentId|Nested probe|Parent agent/.test(text)) bodies.push({ url: new URL(r.url()).pathname, text: text.slice(0, 6000) });
      } catch {}
    });
    await gotoSession(pg, arm, NEST, { theme: 'dark', view: view === 'cockpit' ? 'cockpit' : undefined });
    await pg.locator('[data-plan-node-id="nest-step"]').first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(5000);
    const f = { node: await pg.evaluate(NODE) };
    const art = pg.locator('article', { has: pg.locator('[data-plan-node-id="nest-step"]') }).first();
    if (await art.count()) {
      await art.scrollIntoViewIfNeeded();
      await art.screenshot({ path: `${FIGS}/nest-node-${view}-${arm}.png` });
      const planRoot = await art.evaluateHandle((a) => {
        let r = a;
        while (r && !r.querySelector('[class*="overviewStat"]')) r = r.parentElement;
        return r;
      });
      await planRoot.asElement()?.screenshot({ path: `${FIGS}/nest-plan-${view}-${arm}.png` }).catch(() => {});
    }
    if (view === 'cockpit') {
      await pg.locator('[data-plan-node-id="nest-step"]').first().click().catch(() => {});
      await sleep(800);
      if (!(await pg.locator('[data-testid="workflow-step-detail"]').count())) await pg.locator('[data-testid="open-workflow"]').click().catch(() => {});
      await sleep(1000);
      f.stepDetail = await pg.locator('[data-testid="workflow-step-detail"]').first().innerText().catch(() => null);
      f.inspector = await pg.locator('[data-testid="workflow-inspector"]').first().innerText().catch(() => null);
    }
    f.daemonBodies = bodies;
    f.problems = problems.filter((p) => !noise(p));
    facts[`${view}-${arm}`] = f;
    console.log('nest', view, arm, JSON.stringify(f.node));
    await context.close();
  }
}
writeJson(`nest-${label}.json`, facts);
await browser.close();
