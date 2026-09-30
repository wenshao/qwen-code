// Debug: dump fold-related state around a turn fold.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:13081';
const id = fs.readFileSync('/root/rig13081/out/session-id.txt', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 900 } })).newPage();
await page.goto(`${BASE}/session/${encodeURIComponent(id)}`);
await page.waitForSelector('[data-web-shell-composer-editor] .cm-content', { timeout: 30000 });
await sleep(800);
await page.getByRole('button', { name: /Toggle right panel|切换右侧扩展区/ }).click();
await page.getByTestId('right-panel-open-trajectory').click();
const grid = page.getByTestId('trajectory-rows');
await grid.waitFor({ state: 'visible', timeout: 20000 });
await page.getByTestId('trajectory-row-request').first().waitFor({ timeout: 20000 });
await sleep(600);

const dump = async (tag) => {
  const rowcount = await grid.getAttribute('aria-rowcount');
  const mounted = await page.locator('[data-testid="trajectory-rows"] [role="row"]').count();
  const turns = await page.getByTestId('trajectory-turn').count();
  const collapse = await page.getByRole('button', { name: /^Collapse/ }).allTextContents().catch(() => []);
  const collapseLabels = await page.getByRole('button', { name: /^Collapse/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  const expandLabels = await page.getByRole('button', { name: /^Expand/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  console.log(`[${tag}] rowcount=${rowcount} mounted=${mounted} turn-headers=${turns}`);
  console.log(`  collapse: ${JSON.stringify(collapseLabels)}`);
  console.log(`  expand:   ${JSON.stringify(expandLabels)}`);
};

await dump('initial');
const firstTurn = page.getByTestId('trajectory-turn').first();
console.log('first turn text:', JSON.stringify((await firstTurn.textContent())?.slice(0, 120)));
await firstTurn.getByRole('button', { name: /^Collapse/ }).click();
await sleep(600);
await dump('after-fold');
await browser.close();
