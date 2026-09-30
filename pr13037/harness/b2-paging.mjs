// b2: page through a 12 MiB text output and compare every rendered page with the bytes a local run produces.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { chromium, open, SHOTS, expandShell, openPanel, waitPage, rig } from './pw.mjs';
L.openLog('b2-paging');
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const big = s4.find((r) => r.case === 'biglog');
const expected = execFileSync('/bin/bash', ['-c', `${L.NODE22} ${L.R}/loggen.mjs 157286 3 2 2>/dev/null; true`], { maxBuffer: 64 << 20 });
const PAGE = 65536;
const browser = await chromium.launch();
const { page, logs } = await open(browser, big.session, '&save=opfs');
await expandShell(page);
await page.screenshot({ path: `${SHOTS}/b2-01-card.png` });
await openPanel(page);
let dialog = await waitPage(page);
const state = async () => {
  await waitPage(page);
  const label = await dialog.locator('p.text-xs').first().innerText();
  const text = await dialog.locator('pre[data-managed-output-bytes]').evaluate((el) => el.textContent);
  const m = /Bytes ([\d,]+)–([\d,]+) of ([\d,]+)/.exec(label);
  const start = Number(m[1].replace(/,/g, ''));
  const end = Number(m[2].replace(/,/g, ''));
  return { label, start, end, exact: text === expected.subarray(start, end).toString('utf8'), chars: text.length };
};
const click = async (name) => {
  await dialog.getByRole('button', { name }).click();
  await page.waitForTimeout(150);
};
const visited = [];
visited.push(await state());
for (let i = 0; i < 6; i++) {
  await click('Next page');
  visited.push(await state());
}
await page.screenshot({ path: `${SHOTS}/b2-02-page7.png` });
let r = await rig(page);
L.say('forward 7 pages', visited.map((v) => `${v.start}-${v.end} exact=${v.exact}`));
L.say('requests after 7 pages', r.requests.map((q) => `${q.status} ${q.range}`));
const n1 = r.requests.length;
const back = [];
for (let i = 0; i < 6; i++) {
  await click('Previous page');
  back.push(await state());
}
r = await rig(page);
L.say('back 6 pages', back.map((v) => `${v.start}-${v.end} exact=${v.exact}`));
L.say('extra requests while going back', r.requests.slice(n1).map((q) => `${q.status} ${q.range}`));
L.say('all requests carried If-Match and the actor header', r.requests.every((q) => q.ifMatch && q.auth === 'alice'));
L.say('pages needed to reach the last page by clicking', Math.ceil(big.stdout.bytes / PAGE));
// stderr tab + failed badge
await dialog.getByRole('button', { name: /^stderr/ }).click();
await page.waitForTimeout(300);
await waitPage(page);
L.say('stderr tab', (await dialog.locator('pre[data-managed-output-bytes]').innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${SHOTS}/b2-03-stderr.png` });
L.say('browser errors', logs);
await browser.close();
