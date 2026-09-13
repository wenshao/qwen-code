// S1 — idle traffic: open the Web Shell with three expanded, trusted git
// workspaces, touch nothing, and record 95 s of browser→daemon requests.
import { launch, openUi, summarize, count, isFacet, isGit, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const WINDOW = Number(process.env.WINDOW_MS || 95_000);
const { browser, page, reqs, t0 } = await launch();
await openUi(page);
const tOpen = Date.now() - t0;
await sleep(WINDOW);
await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s1-${arm}-idle.png` });
const expanded = await page.locator('[aria-expanded]').evaluateAll((els) =>
  els.map((e) => `${e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 30)}=${e.getAttribute('aria-expanded')}`));
const res = {
  arm, windowMs: WINDOW, tOpen,
  totals: {
    facets: count(reqs, isFacet), skills: count(reqs, (r) => r.kind === 'skills'),
    git: count(reqs, isGit), providers: count(reqs, (r) => r.kind === 'providers'),
    capabilities: count(reqs, (r) => r.kind === 'capabilities'), liveSetup: count(reqs, (r) => r.kind === 'live-setup'),
    all: reqs.length,
  },
  steady_after_20s: summarize(reqs, 20_000),
  firstTwentySeconds: summarize(reqs, 0, 20_000),
  expanded,
};
save(`s1-${arm}`, { ...res, reqs });
console.log(JSON.stringify(res, null, 2));
await browser.close();
