// Real WebShell (vite dev) -> real Spring WebShell adapter -> MySQL + hosted
// harness -> scripted model. Records every /api/agent/web-shell/v1 exchange
// (request body, status, X-Request-Id) and takes screenshots.
//   node ui-flow.mjs <viteUrl> <arm> <outdir> [expectFailure]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('$SCRATCH/wt-pr/packages/web-shell/package.json');
const { chromium } = require('playwright');

const [base, arm, outdir, expectFailure] = process.argv.slice(2);
const tenant = `rig-ui-${arm}-${Date.now().toString(36)}`;
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));
const exchanges = [];
page.on('response', async (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith('/api/agent/web-shell/v1')) return;
  const sub = url.pathname.slice('/api/agent/web-shell/v1'.length);
  const req = response.request();
  let body = null;
  try {
    body = JSON.parse(req.postData() ?? 'null');
  } catch {}
  const headers = await response.allHeaders();
  const entry = { route: sub, accept: (await req.allHeaders())['accept'] ?? null, request: body, status: response.status(), xRequestId: headers['x-request-id'] ?? null };
  if (sub !== '/events/stream') {
    try {
      entry.response = await response.json();
    } catch {}
  }
  exchanges.push(entry);
});

await page.goto(`${base}/?managed=1&managedProvider=java&tenant=${tenant}`);
const composer = page.getByRole('textbox', { name: 'Message the managed agent' });
const send = page.getByRole('button', { name: 'Send', exact: true });
const conversation = page.getByRole('region', { name: 'Managed conversation' });
await composer.waitFor({ timeout: 30000 });

async function ask(text, reply) {
  await composer.fill(text);
  await send.click();
  await conversation.getByText(reply).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
}
let outcome = 'ok';
let settleMs = null;
try {
  if (expectFailure) {
    await composer.fill('First message from the new WebShell');
    await send.click();
    await page.waitForTimeout(6000);
    outcome = 'sent; see screenshot';
  } else {
    await ask('First message from the real WebShell', /REPLY_\d+: .*First message/);
    await ask('Second message on the same session', /REPLY_\d+: .*Second message/);
    const t0 = Date.now();
    await page.getByText('This turn is running').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    settleMs = Date.now() - t0;
  }
} catch (e) {
  outcome = `error: ${e.message.split('\n')[0]}`;
}
await page.screenshot({ path: `${outdir}/${arm}.png` });
const summary = {
  arm,
  tenant,
  url: page.url(),
  outcome,
  settleMs,
  errors,
  exchanges: exchanges.map((e) => ({
    route: e.route,
    status: e.status,
    xRequestId: e.xRequestId,
    accept: e.route === '/events/stream' ? e.accept : undefined,
    inputTypes: e.request?.input?.map((b) => b.type),
    requestId: e.request?.requestId,
    idempotencyKey: e.request?.idempotencyKey,
    streamBody: e.route === '/events/stream' ? e.request : undefined,
    error: e.response?.error,
  })),
  conversationText: (await conversation.innerText().catch(() => '')).slice(0, 1500),
  bodyText: (await page.locator('body').innerText()).slice(0, 1500),
};
fs.writeFileSync(`${outdir}/${arm}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ arm: summary.arm, outcome, settleMs, errors: errors.slice(0, 5), exchanges: summary.exchanges.filter((e) => e.route !== '/events/stream' || e.status !== 200).slice(0, 12) }, null, 1));
await browser.close();
