// S4 — providers reads: ordinary chat startup (25 s idle), then open Settings,
// stay 8 s, close it, stay closed 10 s, reopen once more. Counts
// GET /workspace/providers and /live/setup per phase.
import { launch, openUi, summarize, count, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const { browser, page, reqs, t0 } = await launch();
await openUi(page);
const now = () => Date.now() - t0;
const prov = (r) => r.kind === 'providers';
await sleep(25_000);
const phases = { startup: { providers: count(reqs, prov, 0, now()), paths: reqs.filter(prov).map((r) => `${r.t}ms ${r.path}`) } };
const settingsBtn = page.getByRole('complementary').getByRole('button', { name: 'Settings', exact: true });
async function openSettings(label) {
  const from = now();
  await settingsBtn.click();
  await sleep(8_000);
  const shot = `/root/git/h11644/shots/${process.env.OUTDIR || ''}s4-${arm}-${label}.png`;
  await page.screenshot({ path: shot });
  phases[label] = { providers: count(reqs, prov, from, now()), liveSetup: count(reqs, (r) => r.kind === 'live-setup', from, now()) };
}
async function closeSettings(label) {
  await page.keyboard.press('Escape');
  await sleep(500);
  let composerVisible = await page.locator('[data-web-shell-composer-editor] .cm-content').isVisible();
  if (!composerVisible) {
    const back = page.getByRole('button', { name: /^(Close|Back|Close settings)$/ }).first();
    if (await back.count()) await back.click();
    await sleep(500);
    composerVisible = await page.locator('[data-web-shell-composer-editor] .cm-content').isVisible();
  }
  const from = now();
  await sleep(10_000);
  phases[label] = { composerVisible, providers: count(reqs, prov, from, now()) };
}
await openSettings('settingsOpen1');
const buttonsInSettings = await page.getByRole('button').evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)).filter(Boolean))]);
await closeSettings('closed1');
await openSettings('settingsOpen2');
await closeSettings('closed2');
const res = { arm, phases, buttonsInSettings, all: summarize(reqs) };
save(`s4-${arm}`, { ...res, reqs });
console.log(JSON.stringify(res, null, 2));
await browser.close();
