// S9 — R1-54 staleness: read beta-lib's hover summary, close it, change the
// repo while closed, reopen and sample the summary every 50 ms until it
// reflects the new state.
import { execSync } from 'node:child_process';
import { launch, openUi, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const REPO = '/root/git/h11644/ws/beta-lib';
const { browser, page } = await launch();
await openUi(page);
const header = page.getByRole('complementary').getByRole('button', { name: /^beta-lib/ }).first();
await header.waitFor();
await sleep(8_000);
const details = page.getByRole('dialog', { name: 'beta-lib' });
const summary = async () => (await details.innerText().catch(() => '')).split('\n').find((l) => /modified|clean|stashed|untracked|ahead|behind/i.test(l)) ?? '(none)';
await header.hover(); await details.waitFor(); await sleep(1_500);
const before = await summary();
await page.mouse.move(700, 850); await sleep(1_000);
execSync(`cd ${REPO} && echo changed >> f2.txt && echo changed >> f3.txt && echo new > untracked.txt`);
const gitNow = execSync(`cd ${REPO} && git status --porcelain`).toString().trim().split('\n');
await sleep(5_000);
const tHover = Date.now();
await header.hover();
await details.waitFor();
const tVisible = Date.now();
const samples = [];
for (let i = 0; i < 60; i++) { samples.push([Date.now() - tVisible, await summary()]); if (samples.at(-1)[1] !== before && i > 0) break; await sleep(50); }
await page.screenshot({ path: `/root/git/h11644/shots/s9-${arm}-reopen.png`, clip: { x: 0, y: 0, width: 900, height: 520 } });
execSync(`cd ${REPO} && git checkout -- f2.txt f3.txt && rm -f untracked.txt`);
const firstFresh = samples.find(([, s]) => s !== before);
const res = { arm, before, gitPorcelainWhileClosed: gitNow, hoverToVisibleMs: tVisible - tHover, firstSample: samples[0], firstFresh: firstFresh ?? null, samples: samples.slice(0, 12) };
save(`s9-${arm}`, res);
console.log(JSON.stringify(res, null, 2));
await browser.close();
