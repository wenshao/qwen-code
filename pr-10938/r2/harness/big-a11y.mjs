// BIG session (525 dependencies, > MAX_RENDERED_PLAN_EDGES): no edges drawn, so the
// visible chip row is the only statement — the sr-only summary must NOT duplicate it.
import { launch, openPage, gotoSession, sleep, writeJson, sid, noise } from './lib2.mjs';
const BIG = sid('r2BIG');
const browser = await launch();
const facts = {};
for (const arm of ['base', 'revert', 'head']) {
  const { page: pg, problems, context } = await openPage(browser, { width: 1440, height: 1000 });
  await gotoSession(pg, arm, BIG, { theme: 'dark', view: 'cockpit' });
  await pg.locator('[data-plan-node-id="leaf-1"]').first().waitFor({ timeout: 30000 });
  await sleep(2500);
  facts[arm] = await pg.evaluate(() => {
    const arts = [...document.querySelectorAll('[data-plan-node-id]')].map((b) => b.closest('article'));
    const leaf1 = document.querySelector('[data-plan-node-id="leaf-1"]').closest('article');
    return {
      nodes: arts.length,
      edgesDrawn: document.querySelectorAll('[data-plan-edge]').length,
      notice: (document.body.innerText.match(/Too many dependencies to draw[^\n]*/) || [null])[0],
      srSummaries: document.querySelectorAll('[class*="nodeDependencyText"]').length,
      visibleDependsRows: arts.filter((a) => a.querySelector('[class*="dependencies"]')).length,
      leaf1Height: Math.round(leaf1.getBoundingClientRect().height),
    };
  });
  facts[arm].leaf1Name = (await pg.locator('[data-plan-node-id="leaf-1"]').first().ariaSnapshot()).slice(0, 260);
  facts[arm].problems = problems.filter((p) => !noise(p));
  console.log('big', arm, JSON.stringify(facts[arm]));
  await context.close();
}
writeJson('big-a11y.json', facts);
await browser.close();
