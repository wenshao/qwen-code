// Drive the real Web Shell (Java managed provider) through the action-response
// budget terminal. usage: node ui-shot.mjs <arm> <vitePort>
import fs from 'node:fs';
import { createRequire } from 'node:module';

const [arm, vitePort] = process.argv.slice(2);
const RIG = '/Users/wenshao/pr13219-rig';
const require = createRequire(`${RIG}/src-head/packages/web-shell/package.json`);
const { chromium } = require('playwright');
const ui = JSON.parse(fs.readFileSync(`${RIG}/runs/ui-${arm}/ui.json`, 'utf8'));
const outDir = `${RIG}/fig/ui-${arm}`;
fs.mkdirSync(outDir, { recursive: true });
const ctl = async (p) => (await fetch(`http://127.0.0.1:${ui.control}${p}`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (step, extra = {}) => { const e = { t: new Date().toISOString(), step, ...extra }; log.push(e); console.log(JSON.stringify(e)); };

const sid = process.env.SID ?? (await ctl(`/session?prompt=${encodeURIComponent('[WRITE] write the probe file')}`)).id;
note('session', { sid });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
const url = `http://localhost:${vitePort}/?managedProvider=java&tenant=retry-e2e&managed=1&managedSession=${sid}&language=en&theme=light`;
const card = page.locator('[data-testid="managed-approval"]');
const dom = async () => page.evaluate(() => ({
  cardVisible: !!document.querySelector('[data-testid="managed-approval"]'),
  alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()).filter(Boolean),
  statusLines: [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 4),
})).catch((e) => ({ domError: String(e) }));
const shot = async (name, step) => { await page.screenshot({ path: `${outDir}/${name}.png` }); note(step, { shot: name, dom: await dom(), state: await ctl(`/state?sid=${sid}`) }); };

try {
  await page.goto(url);
  await card.waitFor({ state: 'visible', timeout: 90000 });
  await sleep(1000);
  await shot('01-approval-shown', 'approval card visible');
  await ctl('/fault/add');
  const allow = card.getByText(/allow once/i).first();
  note('buttons', { html: (await card.innerHTML()).replace(/<svg[\s\S]*?<\/svg>/g, '').slice(0, 600) });
  await allow.click();
  note('clicked allow');
  for (let i = 0; i < 60; i++) { const s = await ctl(`/state?sid=${sid}`); if (/FAILED|COMPLETED/.test(s.op)) break; await sleep(500); }
  await sleep(4000);
  await shot('02-after-budget-terminal', 'operation terminal, fault still on');
  await ctl('/fault/clear');
  await sleep(10000);
  await shot('03-fault-cleared-10s', 'fault cleared 10 s ago, no user action');
  await page.reload();
  await card.waitFor({ state: 'visible', timeout: 60000 }).catch(() => note('card did not return after reload'));
  await sleep(1000);
  await shot('04-after-reload', 'after page reload');
  if (await card.isVisible().catch(() => false)) {
    await card.getByText(/allow once/i).first().click();
    note('clicked allow again');
    for (let i = 0; i < 60; i++) { const s = await ctl(`/state?sid=${sid}`); if (s.turns?.some((t) => /COMPLETED/.test(t))) break; await sleep(500); }
    await sleep(3000);
    await shot('05-after-reclick', 're-clicked allow after reload');
  }
} catch (e) {
  note('error', { error: String(e) });
  await page.screenshot({ path: `${outDir}/error.png` }).catch(() => {});
} finally {
  fs.writeFileSync(`${outDir}/log.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
