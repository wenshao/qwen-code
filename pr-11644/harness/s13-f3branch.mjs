// S13 — F3: with alpha-app's session attached AND its branch visible (environment
// card open), switch alpha-app to feature/s13 and wait until the UI shows it.
// Then start a new task in beta-lib (on main) and sample the branch shown there.
import { execSync } from 'node:child_process';
import { launch, openUi, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const ALPHA = '/root/git/h11644/ws/alpha-app';
const { browser, page } = await launch();
const branchTexts = async () => (await page.locator('[data-web-shell-git-branch]').allInnerTexts().catch(() => [])).map((s) => s.trim());
const envVisible = async () => page.getByTestId('environment-panel').isVisible().catch(() => false);
const envText = async () => ((await envVisible()) ? (await page.getByTestId('environment-panel').innerText({ timeout: 3000 }).catch(() => '')) : '').replace(/\s+/g, ' ');
try {
  await openUi(page);
  await sleep(6_000);
  const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
  await editor.click();
  const seed = `seed s13 ${arm} ${Date.now()}`;
  await page.keyboard.type(seed, { delay: 10 });
  await page.keyboard.press('Enter');
  await page.getByText(new RegExp(`ACK<${seed}`)).first().waitFor({ timeout: 60_000 });
  await sleep(1_500);
  if (!(await page.getByTestId('environment-panel').isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle environment information' }).click();
    await sleep(1_500);
  }
  const envBefore = await envText();
  execSync(`cd ${ALPHA} && git checkout -q -b feature/s13`);
  let alphaShowsFeature = false, waitedMs = 0;
  const tw = Date.now();
  for (let i = 0; i < 70 && !alphaShowsFeature; i++) {
    if (i % 10 === 5) await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await sleep(1_000);
    alphaShowsFeature = (await envText()).includes('feature/s13') || (await branchTexts()).some((t) => t.includes('feature/s13'));
  }
  waitedMs = Date.now() - tw;
  await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s13-${arm}-alpha.png` });
  const header = page.getByRole('complementary').getByRole('button', { name: /^beta-lib/ }).first();
  await header.hover();
  await header.locator('..').getByRole('button', { name: 'Workspace actions' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'New task' }).click();
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < 16; i++) {
    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    samples.push({ ms: Date.now() - t0, chips: await branchTexts(), env: (await envText()).slice(0, 80), bodyHasFeature: body.includes('feature/s13') });
    await sleep(500);
  }
  await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s13-${arm}-beta.png` });
  const leaked = samples.filter((s) => s.bodyHasFeature || s.chips.some((c) => c.includes('feature/s13')) || s.env.includes('feature/s13'));
  const res = { arm, envBefore: envBefore.slice(0, 120), alphaShowsFeature, waitedMs, leakedSamples: leaked.length, firstLeak: leaked[0] ?? null, samples };
  save(`s13-${arm}`, res);
  console.log(JSON.stringify({ ...res, samples: samples.slice(0, 3) }, null, 2));
} finally {
  execSync(`cd ${ALPHA} && git checkout -q main && (git branch -q -D feature/s13 || true)`);
  await browser.close();
}
