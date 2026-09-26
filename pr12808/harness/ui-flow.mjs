// Real WebShell (vite dev) -> real Spring WebShell adapter -> MySQL + packaged
// hosted harness -> scripted model. Records every /api/agent/web-shell/v1
// request the browser sends and takes screenshots.
//   node ui-flow.mjs <viteUrl> <arm> <outdir>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.HOME}/git/pr12808-head/packages/web-shell/package.json`);
const { chromium } = require('playwright');

const [base, arm, outdir] = process.argv.slice(2);
const tenant = `rig-ui-${arm}-${Date.now().toString(36)}`;
fs.mkdirSync(outdir, { recursive: true });
const trafficPath = `${outdir}/ui-traffic-${arm}.jsonl`;
fs.writeFileSync(trafficPath, '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const ops = {
  '/sessions/query': 'webShellListSessions',
  '/sessions/get': 'webShellGetSession',
  '/transcript/query': 'webShellTranscript',
  '/events/stream': 'webShellStreamEvents',
  '/sessions/create': 'webShellCreateSession',
  '/turns/submit': 'webShellSubmitTurn',
  '/turns/cancel': 'webShellCancelTurn',
};
const requests = [];
page.on('response', async (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith('/api/agent/web-shell/v1')) return;
  const sub = url.pathname.slice('/api/agent/web-shell/v1'.length);
  const req = response.request();
  let body = null;
  try {
    body = JSON.parse(req.postData() ?? 'null');
  } catch {}
  const entry = { op: ops[sub], path: url.pathname, request: body, status: response.status() };
  requests.push(entry);
  if (sub === '/events/stream') {
    fs.appendFileSync(trafficPath, JSON.stringify({ kind: 'request-only', ...entry }) + '\n');
    return;
  }
  let json = null;
  try {
    json = await response.json();
  } catch {}
  fs.appendFileSync(
    trafficPath,
    JSON.stringify({ kind: 'exchange', op: ops[sub], expected: sub.endsWith('create') || sub.startsWith('/turns') ? 202 : 200, method: 'POST', path: url.pathname, request: body, status: response.status(), headers: await response.allHeaders(), body: json }) + '\n',
  );
});

const url = `${base}/?managed=1&managedProvider=java&tenant=${tenant}`;
await page.goto(url);
const composer = page.getByRole('textbox', { name: 'Message the managed agent' });
const send = page.getByRole('button', { name: 'Send', exact: true });
const conversation = page.getByRole('region', { name: 'Managed conversation' });
await composer.waitFor();

async function ask(text, reply) {
  await composer.fill(text);
  await send.click();
  await conversation.getByText(reply).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
}
await ask('First message from the real WebShell', /REPLY_\d+: .*First message/);
await ask('Second message on the same session', /REPLY_\d+: .*Second message/);
await page.screenshot({ path: `${outdir}/${arm}-01-live.png` });

const sessionUrl = page.url();
await page.reload();
await conversation.getByText(/REPLY_\d+: .*Second message/).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outdir}/${arm}-02-reloaded.png` });

const summary = {
  arm,
  tenant,
  sessionUrl,
  errors,
  streamBodies: requests.filter((r) => r.op === 'webShellStreamEvents').map((r) => r.request),
  createBodies: requests.filter((r) => r.op === 'webShellCreateSession').map((r) => r.request),
  statuses: requests.map((r) => `${r.op}:${r.status}`),
  conversationText: (await conversation.innerText()).slice(0, 1200),
};
fs.writeFileSync(`${outdir}/ui-summary-${arm}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
await browser.close();
