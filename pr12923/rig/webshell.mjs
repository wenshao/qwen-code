// Real Web Shell (bundled with the daemon under test) opened through nginx
// (client_max_body_size 1m). Paste a 2855x1625 PNG into the composer and send.
//   node webshell.mjs <head|base> <paste|multifail|midturn>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { SP, TOKEN, Daemon, prepareHome, sleep } from './lib.mjs';
import { startFaultProxy } from './faultproxy.mjs';
import { sha256 } from './png.mjs';

const arm = process.argv[2];
const mode = process.argv[3] ?? 'paste';
const NGINX = 'http://127.0.0.1:18080';
const FAKE_PORT = 18952;
const require = createRequire(path.join(SP, 'wt-head', 'package.json'));
const { chromium } = require('playwright');

const RUN = path.join(SP, 'runs', `web-${arm}-${mode}`);
fs.rmSync(RUN, { recursive: true, force: true });
fs.mkdirSync(RUN, { recursive: true });
const SHOTS = path.join(SP, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const LARGE = fs.readFileSync(path.join(SP, 'runs', 'large.png'));
const XL = fs.readFileSync(path.join(SP, 'runs', 'xl.png'));

const fakeLedger = path.join(RUN, 'fake-model.jsonl');
const fake = spawn(process.execPath, [path.join(SP, 'rig/fake-model.mjs'), String(FAKE_PORT), fakeLedger], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => fake.stdout.once('data', r));
const proxy = await startFaultProxy({ port: 18940, target: 0 });

const root = path.join(RUN, 'daemon');
const ws = path.join(root, 'ws');
const { home, qwenHome } = prepareHome({ root, ws, fakePort: FAKE_PORT });
const d = new Daemon({
  wt: path.join(SP, `wt-${arm}`),
  home,
  qwenHome,
  ws,
  fakePort: FAKE_PORT,
  logFile: path.join(root, 'daemon.log'),
  port0: arm === 'head' ? 18931 : 18932,
  extraEnv: { QWEN_RUNTIME_DIR: path.join(root, 'runtime') },
});
d.extraArgs = ['--allow-origin', 'http://127.0.0.1:18080'];
await d.start();
proxy.setTarget(d.port);

function storedFiles(sid) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === `session-${encodeURIComponent(sid)}`) {
          for (const f of fs.readdirSync(p)) {
            const b = fs.readFileSync(path.join(p, f));
            out.push({ name: f, bytes: b.length, sha256: sha256(b) });
          }
        } else walk(p);
      }
    }
  };
  walk(root);
  return out;
}
const modelCalls = () =>
  fs.existsSync(fakeLedger)
    ? fs.readFileSync(fakeLedger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.main)
    : [];

const s = await d.createSession();
const sid = s.sessionId;

const browser = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const net = [];
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (!/attachment|\/prompt|capabilities|\/messages/.test(u.pathname)) return;
  const req = r.request();
  const body = req.postDataBuffer();
  net.push({
    method: req.method(),
    path: u.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (x) => x.slice(0, 8)),
    query: u.search || undefined,
    reqBytes: body ? body.length : 0,
    status: r.status(),
  });
});
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
});

await page.goto(`${NGINX}/session/${sid}?token=${TOKEN}&lang=en`);
const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
await editor.waitFor({ timeout: 60000 });
await sleep(2500);

async function paste(buffers) {
  await editor.evaluate(
    (element, list) => {
      const clipboard = new DataTransfer();
      list.forEach((b64, i) => {
        const bin = atob(b64);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        clipboard.items.add(new File([bytes], `screenshot-${i + 1}.png`, { type: 'image/png' }));
      });
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    },
    buffers.map((b) => b.toString('base64')),
  );
  await page
    .locator('[data-web-shell-composer-images] img')
    .nth(buffers.length - 1)
    .waitFor({ timeout: 20000 });
}

async function send(text) {
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

const result = { arm, mode, sessionId: sid, source: { bytes: LARGE.length, sha256: sha256(LARGE) } };

if (mode === 'paste') {
  await paste([LARGE]);
  await page.screenshot({ path: path.join(RUN, 'composer.png') });
  await send('PR12923 what is in this screenshot?');
  const deadline = Date.now() + 60000;
  let outcome;
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText();
    if (/Received 1 image/.test(text)) {
      outcome = 'model-replied';
      break;
    }
    if (/413|too large|Request Entity|upload failed|Attachment upload/i.test(text)) {
      outcome = 'error-visible';
      await sleep(1500);
      break;
    }
    await sleep(500);
  }
  result.outcome = outcome;
  result.visibleErrorLines = (await page.locator('body').innerText())
    .split('\n')
    .filter((l) => /413|too large|Request Entity|failed|proxy/i.test(l))
    .slice(0, 6);
  result.messageImages = await page.locator('[data-web-shell-message-list] img').count();
  await page.screenshot({ path: path.join(SHOTS, `web-${arm}-paste.png`) });
  // Download through the same gateway, as the preview/download button does.
  result.browserDownload = await page.evaluate(
    async ({ sid, token, clientId }) => {
      const r = await fetch(`/session/${sid}/attachments/image.png`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { status: r.status };
      const buf = await r.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return {
        status: r.status,
        bytes: buf.byteLength,
        sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      };
    },
    { sid, token: TOKEN },
  );
  // Open the sent image in the preview for the evidence shot, if it rendered.
  if (result.messageImages > 0) {
    await page.locator('[data-web-shell-message-list] img').first().click().catch(() => {});
    await sleep(1500);
    await page.screenshot({ path: path.join(SHOTS, `web-${arm}-preview.png`) });
    await page.keyboard.press('Escape').catch(() => {});
  }
} else if (mode === 'multifail') {
  // Two large screenshots in one message; every chunk of the second upload is
  // rejected by the gateway with a non-retryable 500. The first upload
  // completes, so the Web Shell must remove it and cancel the second.
  const seen = [];
  proxy.addFault({
    persistent: true,
    action: 'status',
    status: 500,
    match: (e) => {
      if (!e.path.endsWith('/chunks')) return false;
      const id = e.path.split('/')[4];
      if (!seen.includes(id)) seen.push(id);
      return id === seen[1];
    },
  });
  await paste([LARGE, XL]);
  await send('PR12923 two screenshots');
  const until = Date.now() + 30000;
  while (Date.now() < until && !/Prompt failed|upload failed/i.test(await page.locator('body').innerText())) await sleep(200);
  await page.screenshot({ path: path.join(SHOTS, `web-${arm}-multifail.png`) });
  await sleep(4000);
  result.visibleErrorLines = (await page.locator('body').innerText())
    .split('\n')
    .filter((l) => /failed|error|500|upload/i.test(l))
    .slice(0, 8);
  result.faultHits = proxy.faults[0]?.hits;
  result.composerImagesAfter = await page.locator('[data-web-shell-composer-images] img').count();
} else if (mode === 'midturn') {
  // Start a slow turn, then paste + send while it is still running.
  await send('PR12923 SLOW-TURN first message');
  await sleep(2000);
  await paste([LARGE]);
  await send('PR12923 image sent while the turn is running');
  await sleep(1500);
  await page.screenshot({ path: path.join(RUN, 'midturn-during.png') });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (modelCalls().some((c) => c.lastUserImages.length > 0 || c.images.length > 0)) break;
    await sleep(500);
  }
  await sleep(3000);
  result.messageImages = await page.locator('[data-web-shell-message-list] img').count();
  await page.screenshot({ path: path.join(SHOTS, `web-${arm}-midturn.png`) });
}

await sleep(1000);
result.network = net;
result.faultProxy = proxy.ledger
  .filter((e) => /attachment/.test(e.path))
  .map((e) => ({
    m: e.method,
    p: e.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (x) => x.slice(0, 8)),
    q: e.query || undefined,
    bytes: e.reqBytes,
    status: e.status,
    fault: e.fault,
  }));
result.files = storedFiles(sid);
result.modelCalls = modelCalls().map((c) => ({
  lastUserText: c.lastUserText.slice(0, 80),
  images: c.images.map((i) => ({ role: i.role, message: i.message, bytes: i.bytes, sha256: i.sha256.slice(0, 16) })),
  lastUserImages: c.lastUserImages.length,
  reply: c.reply,
}));
result.consoleErrors = consoleErrors.slice(0, 10);
fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2).slice(0, 6000));
await browser.close();
await d.stop();
await proxy.close();
fake.kill();
process.exit(0);
