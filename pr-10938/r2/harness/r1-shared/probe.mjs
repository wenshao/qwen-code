// node probe.mjs <scn> [arm] [view] : screenshot + visible button labels of a session page
import fs from 'node:fs';
import { launch, openPage, gotoSession, sleep, H } from './lib.mjs';

const [scn = 'DAG', arm = 'head', view] = process.argv.slice(2);
const sid = fs.readFileSync(`${H}/out/session-${scn}.txt`, 'utf8').trim();
const browser = await launch();
const { page, problems } = await openPage(browser, { theme: 'dark' });
await gotoSession(page, arm, sid, { theme: 'dark', view });
await sleep(5000);
const buttons = await page.locator('button:visible').evaluateAll((bs) =>
  bs.map((b) => (b.innerText.trim() || b.getAttribute('aria-label') || '').slice(0, 60)).filter(Boolean),
);
console.log('buttons', JSON.stringify(buttons));
await page.screenshot({ path: `${H}/out/probe-${scn}-${arm}${view ? '-' + view : ''}.png` });
console.log('problems', problems.filter((p) => !p.includes('Conversations') && !p.includes('Failed to load resource')));
await browser.close();
