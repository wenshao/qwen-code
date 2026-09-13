// S11 — what the PR removes: on the base bundle, beta-lib's sidebar header Git
// chip opens a branch picker with Changes/Commit for a NON-active workspace.
import { launch, openUi, sleep } from './ui.mjs';
const arm = process.argv[2];
const { browser, page } = await launch();
await openUi(page);
await sleep(8_000);
const side = page.getByRole('complementary').first();
const chips = side.getByRole('button', { name: /— main$/ });
const n = await chips.count();
const labels = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
await page.screenshot({ path: `/root/git/h11644/shots/s11-${arm}-sidebar.png`, clip: { x: 0, y: 0, width: 560, height: 760 } });
let popoverButtons = [];
if (n >= 2) {
  await chips.nth(1).click();
  await sleep(2_500);
  const dlg = page.getByRole('dialog').last();
  popoverButtons = await dlg.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40)).filter(Boolean));
  const box = await dlg.boundingBox();
  await page.screenshot({ path: `/root/git/h11644/shots/s11-${arm}-picker.png`, clip: { x: 0, y: 0, width: Math.min(1440, Math.round((box?.x ?? 400) + (box?.width ?? 400) + 30)), height: Math.min(900, Math.round((box?.y ?? 400) + (box?.height ?? 400) + 30)) } });
}
console.log(JSON.stringify({ arm, chipCount: n, labels, popoverButtons }, null, 2));
await browser.close();
