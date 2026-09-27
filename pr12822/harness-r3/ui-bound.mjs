// Real Web Shell W0d page (vite dev, Chromium) -> real Spring on MySQL with a
// rig actor. Creates a bound empty Session, retries a dropped create, and
// records the WebShell exchanges.
//   node ui-bound.mjs <pageUrl> <outdir>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('$SCRATCH/wt-pr/packages/web-shell/package.json');
const { chromium } = require('playwright');

const [pageUrl, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)));
const exchanges = [];
let dropNextCreate = false;
await page.route('**/api/agent/web-shell/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  const request = route.request().postDataJSON();
  const response = await route.fetch();
  let body = null;
  try {
    body = await response.json();
  } catch {}
  exchanges.push({ route: path.replace('/api/agent/web-shell/v1', ''), request, status: response.status(), xRequestId: response.headers()['x-request-id'], body });
  if (path.endsWith('/sessions/create') && dropNextCreate) {
    dropNextCreate = false;
    await route.abort('failed');
    return;
  }
  await route.fulfill({ response });
});

await page.goto(pageUrl);
const dark = () => page.addStyleTag({ content: 'html,body{background:#0d1117}' });
await dark();
await page.getByRole('button', { name: 'Create session' }).waitFor({ timeout: 30000 });
await page.getByRole('combobox', { name: 'Workspace' }).click();
const draining = await page.getByRole('option', { name: /Draining Workspace/ }).isDisabled();
await page.keyboard.press('Escape');
await page.getByLabel('Relative directory').fill('services/./api');
dropNextCreate = true;
await page.getByRole('button', { name: 'Create session' }).click();
await page.getByText('Creation is unconfirmed', { exact: false }).waitFor({ timeout: 15000 });
await page.screenshot({ path: `${outdir}/bound-01-unconfirmed.png` });
await page.reload();
await dark();
await page.getByRole('button', { name: 'Retry the same request' }).click();
const binding = page.locator('[data-managed-workspace-binding]');
await binding.waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outdir}/bound-02-created.png` });
const creates = exchanges.filter((e) => e.route === '/sessions/create');
const gets = exchanges.filter((e) => e.route === '/sessions/get' && e.body?.workspace);
const summary = {
  drainingOptionDisabled: draining,
  bindingText: (await binding.innerText()).replace(/\s+/g, ' '),
  sendButtons: await page.getByRole('button', { name: 'Send' }).count(),
  creates: creates.map((e) => ({ status: e.status, requestId: e.request?.requestId, idempotencyKey: e.request?.idempotencyKey, xRequestId: e.xRequestId, sessionId: e.body?.sessionId, replayed: e.body?.replayed, workspace: e.request?.workspace })),
  lastGetWorkspace: gets.at(-1)?.body?.workspace ?? null,
  errors,
};
fs.writeFileSync(`${outdir}/bound.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
await page.unrouteAll({ behavior: 'ignoreErrors' });
await browser.close();
