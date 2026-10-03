// Same moment on both arms: Skills tab open -> Global setting Disabled -> screenshot when the success notice appears.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDaemon } from './daemon.mjs';
import { chromium, EXE, openShell, openExtensions, card } from './browser-common.mjs';
const [label, armDir, home, ws, port, outDir] = process.argv.slice(2);
const d = await startDaemon({ arm: armDir, home, workspace: ws, port: Number(port), log: join(outDir, `tabreset-${label}.daemon.log`) });
await new Promise((r) => setTimeout(r, 15_000));
const browser = await chromium.launch({ executablePath: EXE });
const res = { label, reps: [] };
try {
  const { page } = await openShell(browser, d, { scale: 2, width: 1280, height: 860 });
  await openExtensions(page);
  await card(page, 'Rich Qwen Extension').click();
  for (let i = 0; i < 3; i++) {
    const target = i % 2 === 0 ? 'Disabled' : 'Enabled';
    await page.getByRole('tab', { name: /^Skills/ }).click();
    if (i === 0) await page.screenshot({ path: join(outDir, `tabreset-${label}-before.png`) });
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: target, exact: true }).click();
    await page.getByText(`Extension "rich-qwen" ${target.toLowerCase()}.`).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    const sel = await page.locator('[role=tab][aria-selected=true]').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((s) => !/^(Tasks|Channels)$/.test(s)));
    if (i === 0) await page.screenshot({ path: join(outDir, `tabreset-${label}-after.png`) });
    res.reps.push({ toggledTo: target, selectedTabAfter: sel });
    await page.waitForTimeout(3500);
  }
} finally { await browser.close(); await d.stop(); }
writeFileSync(join(outDir, `tabreset-${label}.json`), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res));
