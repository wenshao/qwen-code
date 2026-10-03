// Real Chromium -> Web Shell (served by the arm's own daemon) -> real daemon -> real extensions on disk.
// usage: node browser-e2e.mjs <arm> <armDir> <home> <ws> <port> <outDir> [--client-only-label X]
import { renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon } from './daemon.mjs';
import { chromium, EXE, openShell, openExtensions, card, backToList, submitLocalCommand } from './browser-common.mjs';

const [label, armDir, home, ws, port, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const d = await startDaemon({ arm: armDir, home, workspace: ws, port: Number(port), log: join(outDir, `${label}.daemon.log`) });
const split = d.capabilities.features.includes('extension_list_details');
await new Promise((r) => setTimeout(r, 15_000)); // let the ACP preheat child settle so timings are not skewed by it
const browser = await chromium.launch({ executablePath: EXE });
const result = { label, daemonAdvertisesSplit: split, timings: { listMs: [], detailMs: [] }, tabs: {}, scenarios: {} };
const shot = (page, name) => page.screenshot({ path: join(outDir, `${label}-${name}.png`) });
const tab = (page, re) => page.getByRole('tab', { name: re });
const detailReady = (page) => tab(page, /^Commands/).waitFor({ timeout: 30_000 });
const selectedTab = (page) => page.locator('[role=tab][aria-selected=true]').evaluateAll((els) => els.map((e) => e.textContent.trim()));

async function collectTabs(page) {
  const out = {};
  for (const name of ['Commands', 'Skills', 'Agents', 'MCP servers', 'Context files']) {
    const t = tab(page, new RegExp(`^${name}`));
    const text = (await t.textContent()).trim();
    await t.click();
    const panel = page.locator('[role=tabpanel][data-state=active]');
    await panel.waitFor();
    // CapabilityList rows use content-visibility:auto, so read textContent rather than innerText
    out[text] = await panel.evaluate((el) => { const rows = [...el.querySelectorAll('span.break-words')].map((s) => s.textContent.trim()); return rows.length ? rows : [el.textContent.trim()]; });
  }
  await tab(page, /^Overview/).click();
  return out;
}

try {
  const { page, wire } = await openShell(browser, d, { scale: 2, width: 1280, height: 860 });
  // ---- timing: open list, open detail (5 reps, 2.5 s apart so the legacy 2 s cache never answers)
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    result.timings.listMs.push(await openExtensions(page));
    const t = Date.now();
    await card(page, 'Bulk 0').click();
    await detailReady(page);
    result.timings.detailMs.push(Date.now() - t);
    await page.getByRole('button', { name: 'back' }).first().click(); // close the manager panel
    await page.getByRole('heading', { name: 'Manage Extensions' }).waitFor({ state: 'detached' });
  }
  result.wireTimingPhase = wire.filter((w) => w.kind === 'req' && w.path !== '/capabilities').map((w) => `${w.method} ${w.path}`);
  wire.length = 0;

  // ---- list + detail screenshots and tab contents
  await openExtensions(page);
  await shot(page, 'list');
  for (const [title, key] of [['Rich Qwen Extension', 'rich-qwen'], ['agent-plugin', 'agent-plugin'], ['Bulk 0', 'bulk-000']]) {
    await card(page, title).click();
    await detailReady(page);
    if (key === 'rich-qwen') await shot(page, 'detail-overview');
    result.tabs[key] = await collectTabs(page);
    if (key === 'rich-qwen') {
      await tab(page, /^Commands/).click(); await shot(page, 'detail-commands');
      await tab(page, /^MCP servers/).click(); await shot(page, 'detail-mcp');
      await tab(page, /^Overview/).click();
    }
    await backToList(page);
  }
  result.wireBrowsePhase = wire.filter((w) => w.kind === 'req' && w.path !== '/capabilities').map((w) => `${w.method} ${w.path}`);
  wire.length = 0;

  // ---- tab state across a list refresh triggered by a real activation change
  {
    await card(page, 'Rich Qwen Extension').click();
    await detailReady(page);
    await tab(page, /^Skills/).click();
    const before = await selectedTab(page);
    await page.evaluate(() => {
      window.__frames = [];
      const sample = () => {
        const sel = [...document.querySelectorAll('[role=tab][aria-selected=true]')].map((e) => e.textContent.trim()).filter((s) => !/^(Tasks|Channels)$/.test(s));
        const loading = [...document.querySelectorAll('[role=status]')].some((e) => /Loading/.test(e.textContent));
        window.__frames.push({ t: performance.now(), sel: sel.join('|'), loading });
        if (window.__frames.length < 4000) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Disabled', exact: true }).click();
    await page.waitForTimeout(4000);
    const afterDisable = await selectedTab(page);
    await shot(page, 'after-toggle');
    const frames = await page.evaluate(() => window.__frames);
    const seq = []; for (const f of frames) { const k = `${f.loading ? 'LOADING' : f.sel || '(no tabs)'}`; if (seq[seq.length - 1] !== k) seq.push(k); }
    // restore
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Enabled', exact: true }).click();
    await page.waitForTimeout(3000);
    result.scenarios.tabAcrossActivationRefresh = { before, afterDisable, paintedSequence: seq, wire: wire.filter((w) => w.kind === 'req' && w.path !== '/capabilities').map((w) => `${w.method} ${w.path}`) };
    wire.length = 0;
    await backToList(page);
  }

  if (split) {
    // ---- loading state (real response, delayed 2 s in the browser)
    await page.route('**/workspace/extensions/*/details', async (route) => { await new Promise((r) => setTimeout(r, 2000)); await route.continue(); });
    await card(page, 'Rich Qwen Extension').click();
    await page.getByRole('status').filter({ hasText: 'Loading...' }).waitFor();
    await shot(page, 'detail-loading');
    await detailReady(page);
    await page.unroute('**/workspace/extensions/*/details');
    await backToList(page);

    // ---- real failure: the extension disappears from disk after the list was loaded -> 404 -> error + retry
    wire.length = 0;
    const dir = join(home, 'extensions', 'toggle-me'); const parked = join(home, 'toggle-me.parked');
    renameSync(dir, parked);
    await card(page, 'toggle-me').click();
    const alert = page.getByRole('alert').filter({ hasText: /not found/i });
    await alert.waitFor({ timeout: 15_000 });
    const errorText = (await alert.innerText()).trim();
    await shot(page, 'detail-error');
    renameSync(parked, dir);
    await page.getByRole('button', { name: 'Try again' }).click();
    await detailReady(page);
    await shot(page, 'detail-retry-ok');
    result.scenarios.errorRetry = { errorText, wire: wire.filter((w) => w.path.includes('/details')).map((w) => w.kind === 'req' ? `${w.method} ${w.path}` : `-> ${w.status}`), skillsAfterRetry: (await tab(page, /^Skills/).textContent()).trim() };
    await backToList(page);

    // ---- stale response race: hold bulk-000's details, move to rich-qwen, then release the late response
    wire.length = 0;
    let release; const held = new Promise((r) => { release = r; });
    let heldDelivered = false;
    await page.route('**/workspace/extensions/bulk-000/details', async (route) => { await held; await route.continue(); heldDelivered = true; });
    await card(page, 'Bulk 0').click();
    await page.getByRole('status').filter({ hasText: 'Loading...' }).waitFor();
    await backToList(page);
    await card(page, 'Rich Qwen Extension').click();
    await detailReady(page);
    const beforeRelease = { heading: await page.locator('h1').first().innerText(), commands: (await tab(page, /^Commands/).textContent()).trim() };
    release();
    await page.waitForTimeout(1500);
    const afterRelease = { heading: await page.locator('h1').first().innerText(), commands: (await tab(page, /^Commands/).textContent()).trim(), skills: (await tab(page, /^Skills/).textContent()).trim() };
    await shot(page, 'stale-race-final');
    result.scenarios.staleRace = { heldDelivered, beforeRelease, afterRelease, wire: wire.filter((w) => w.path.includes('/details')).map((w) => w.kind === 'req' ? `${w.method} ${w.path} @${w.t}` : `-> ${w.path} ${w.status} @${w.t}`) };
    await page.unroute('**/workspace/extensions/bulk-000/details');
    await backToList(page);
  }
} finally {
  await browser.close();
  await d.stop();
  writeFileSync(join(outDir, `${label}.json`), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 1).slice(0, 6000));
