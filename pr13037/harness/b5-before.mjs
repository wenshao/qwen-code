// b5: the same main-era Shell sessions in the WebShell built from main (before) and from the PR (after).
import fs from 'node:fs';
import * as L from './lib.mjs';
import { chromium, SHOTS, transcript } from './pw.mjs';
const ARM = process.env.ARM; // base | pr
const origin = ARM === 'base' ? 'http://localhost:5138' : 'http://localhost:5137';
const st = JSON.parse(fs.readFileSync(`${L.R}/out/s8-upgrade.json`, 'utf8'));
const browser = await chromium.launch();
for (const name of (process.env.NAMES ?? 'main-shell-b').split(',')) {
  const session = st.sessions.find((s) => s.name === name).session;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${origin}/e2e/fixtures/o3-rig.html?theme=light&session=${session}&save=opfs`, { waitUntil: 'load' });
  await page.getByText('Completed').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  if (await page.getByText(/tool calls?$/).count()) {
    if (!(await page.getByText('Shell', { exact: true }).count())) await page.getByText(/tool calls?$/).first().click();
    await page.waitForTimeout(400);
    await page.getByText('Shell', { exact: true }).first().click();
    await page.waitForTimeout(800);
  }
  console.log(`[${ARM} ${name}]`, JSON.stringify({ outputsButton: await page.getByRole('button', { name: 'Outputs' }).count(), viewOutput: await page.getByRole('button', { name: 'View output' }).count(), toolRows: await page.getByText('Shell', { exact: true }).count(), transcript: (await transcript(page)).slice(0, 400) }));
  await page.screenshot({ path: `${SHOTS}/b5-${ARM}-${name}.png` });
  await context.close();
}
await browser.close();
