// node r2/approve2.mjs <label> : approve the pending Plan & Review card like a user.
// After #11423 the approval option is "Approve and execute · <mode>".
import { launch, openPage, gotoSession, sleep, H, sid, noise } from './lib2.mjs';

const label = process.argv[2];
const browser = await launch();
const { page, problems } = await openPage(browser, { theme: 'dark' });
await gotoSession(page, 'head', sid(label), { theme: 'dark' });
const btn = page.locator('button', { hasText: 'Approve and execute' }).first();
await btn.waitFor({ timeout: 30000 });
console.log('clicking', JSON.stringify(await btn.innerText()));
await page.screenshot({ path: `${H}/r2/out/review-${label}.png` });
await btn.click();
await sleep(8000);
await page.screenshot({ path: `${H}/r2/out/approved-${label}.png` });
console.log('approved', label, 'problems', problems.filter((p) => !noise(p)));
await browser.close();
