// Mixed versions: a daemon from one arm serving the other arm's Web Shell client.
// usage: node browser-mixed.mjs <label> <daemonArmDir> <home> <ws> <port> <outDir>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon, get } from './daemon.mjs';
import { chromium, EXE, openShell, openExtensions, card, backToList } from './browser-common.mjs';
const [label, armDir, home, ws, port, outDir] = process.argv.slice(2);
const d = await startDaemon({ arm: armDir, home, workspace: ws, port: Number(port), log: join(outDir, `${label}.daemon.log`) });
await new Promise((r) => setTimeout(r, 15_000));
const index = await get(d, '/');
const entry = String(index.json).match(/assets\/index-[\w-]+\.js/)?.[0];
const browser = await chromium.launch({ executablePath: EXE });
const res = { label, daemonAdvertisesSplit: d.capabilities.features.includes('extension_list_details'), servedClientEntry: entry };
try {
  const { page, wire } = await openShell(browser, d, { scale: 2, width: 1280, height: 860 });
  await openExtensions(page);
  await card(page, 'Rich Qwen Extension').click();
  await page.getByRole('tab', { name: /^Commands/ }).waitFor({ timeout: 30_000 });
  res.tabs = await page.getByRole('tab').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((s) => !/^(Tasks|Channels)$/.test(s)));
  await page.getByRole('tab', { name: /^MCP servers/ }).click();
  res.mcpRows = await page.locator('[role=tabpanel][data-state=active] span.break-words').allTextContents();
  await page.waitForTimeout(700); // let the tab indicator animation settle
  await page.screenshot({ path: join(outDir, `${label}-detail-mcp.png`) });
  await backToList(page);
  res.wire = wire.filter((w) => w.path !== '/capabilities').map((w) => w.kind === 'req' ? `${w.method} ${w.path}` : `-> ${w.status}`);
} finally { await browser.close(); await d.stop(); }
writeFileSync(join(outDir, `${label}.json`), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res));
