// S10 — chat Git consumer gate after a real turn (non-empty chat, where the
// default toolbar no longer carries gitBranch): count alpha-app Git reads for
// 65 s with the environment panel as it opens by default, then toggle it and
// count again. Buttons are dumped so the toggle can be identified.
import { launch, openUi, count, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const { browser, page, reqs, t0 } = await launch();
await openUi(page);
const now = () => Date.now() - t0;
const gitA = (r) => r.ws === 'alpha' && (r.kind === 'git' || r.kind === 'git?wait');
await sleep(6_000);
const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
await editor.click();
await page.keyboard.type('hello from s10', { delay: 20 });
await page.keyboard.press('Enter');
await page.getByText(/ACK<hello from s10/).first().waitFor({ timeout: 60_000 });
await sleep(4_000);
const buttons = await page.getByRole('button').evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().slice(0, 40)).filter(Boolean))]);
const regions = await page.locator('[aria-label], [data-web-shell-environment-panel]').evaluateAll((els) => [...new Set(els.map((e) => e.tagName + ':' + (e.getAttribute('aria-label') || '')).filter((s) => /environment|panel|context/i.test(s)))]);
await page.screenshot({ path: `/root/git/h11644/shots/s10-${arm}-A.png` });
let from = now();
await sleep(65_000);
const phaseA = { git: count(reqs, gitA, from, now()), timeline: reqs.filter((r) => gitA(r) && r.t >= from).map((r) => `${r.t} ${r.kind}`) };
const toggle = page.getByRole('button', { name: /environment|context panel|details panel|toggle panel/i }).first();
let toggled = null;
if (await toggle.count()) { toggled = (await toggle.getAttribute('aria-label')) || (await toggle.innerText()); await toggle.click(); await sleep(1_000); }
await page.screenshot({ path: `/root/git/h11644/shots/s10-${arm}-B.png` });
from = now();
await sleep(65_000);
const phaseB = { toggled, git: count(reqs, gitA, from, now()), timeline: reqs.filter((r) => gitA(r) && r.t >= from).map((r) => `${r.t} ${r.kind}`) };
const res = { arm, buttons, regions, phaseA, phaseB };
save(`s10-${arm}`, { ...res, reqs });
console.log(JSON.stringify(res, null, 2));
await browser.close();
