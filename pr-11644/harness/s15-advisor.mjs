// S15 — merge resolution vs #11342: Settings → model section → advisor role dialog must load models.
import { launch, openUi, count, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const { browser, page, reqs } = await launch();
await openUi(page);
await sleep(6_000);
await page.getByRole('complementary').getByRole('button', { name: 'Settings', exact: true }).click();
await sleep(2_500);
const dump = async () => page.getByRole('button').evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)).filter(Boolean))]);
const categories = await dump();
const modelCat = page.getByRole('button', { name: /^Models?\b/i }).first();
const modelCatFound = await modelCat.count();
if (modelCatFound) { await modelCat.click(); await sleep(2_500); }
const inModel = await dump();
await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s15-${arm}-models.png` });
const advisor = page.getByRole('button', { name: /advisor/i }).or(page.getByRole('button', { name: 'Use main model', exact: true })).first();
const advisorFound = await advisor.count();
let dialogText = null;
if (advisorFound) {
  await advisor.click();
  await sleep(3_000);
  dialogText = (await page.getByRole('dialog').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s15-${arm}-advisor.png` });
}
const res = { arm, modelCatFound, advisorFound, dialogText, providersReads: count(reqs, (r) => r.kind === 'providers'), categories: categories.slice(-30), inModel: inModel.filter((b) => !categories.includes(b)).slice(0, 40) };
save(`s15-${arm}`, res);
console.log(JSON.stringify(res, null, 2));
await browser.close();
