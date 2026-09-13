// Screenshot-only: hover TARGET's details popover (no request accounting).
import { launch, openUi, sleep } from './ui.mjs';
const [arm, target = 'alpha-app'] = process.argv.slice(2);
const { browser, page } = await launch();
await openUi(page);
await sleep(8_000);
const live = await page.getByRole('complementary').getByRole('button', { name: 'Live', exact: true }).count();
const header = page.getByRole('complementary').getByRole('button', { name: new RegExp(`^${target}`) }).first();
await header.hover();
const details = page.getByRole('dialog', { name: target });
await details.waitFor();
await sleep(2_500);
const box = await details.boundingBox();
await page.screenshot({ path: `/root/git/h11644/shots/shot-${arm}-${target}-details.png`, clip: { x: 0, y: 0, width: Math.round(box.x + box.width + 30), height: Math.min(900, Math.max(560, Math.round(box.y + box.height + 30))) } });
console.log(JSON.stringify({ arm, target, liveGroupButtons: live, text: await details.innerText() }));
await browser.close();
