// The same page embedded in the Plugins panel (embedded mode): list -> select -> details.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDaemon } from './daemon.mjs';
import { chromium, EXE, openShell } from './browser-common.mjs';
const [label, armDir, home, ws, port, outDir] = process.argv.slice(2);
const d = await startDaemon({ arm: armDir, home, workspace: ws, port: Number(port), log: join(outDir, `embedded-${label}.daemon.log`) });
await new Promise((r) => setTimeout(r, 15_000));
const browser = await chromium.launch({ executablePath: EXE });
const res = { label };
try {
  const { page, wire } = await openShell(browser, d, { scale: 2, width: 1280, height: 860 });
  await page.getByRole('button', { name: 'Plugins', exact: true }).first().click();
  await page.getByRole('tab', { name: /Extensions/ }).click();
  const c = page.getByRole('button', { name: 'agent-plugin', exact: true });
  await c.waitFor({ timeout: 30_000 });
  await c.click();
  await page.getByRole('tab', { name: /^MCP servers/ }).waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: /^MCP servers/ }).click();
  res.mcpRows = await page.locator('[role=tabpanel][data-state=active] span.break-words').allTextContents();
  res.tabs = await page.getByRole('tab').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  await page.screenshot({ path: join(outDir, `embedded-${label}.png`) });
  res.wire = wire.filter((w) => w.kind === 'req' && w.path !== '/capabilities').map((w) => `${w.method} ${w.path}`);
} finally { await browser.close(); await d.stop(); }
writeFileSync(join(outDir, `embedded-${label}.json`), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res));
