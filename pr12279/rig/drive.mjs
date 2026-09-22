// PR #12279 real-stack driver. Usage:
//   node drive.mjs <arm> <port> <scenario> [outDir]
// scenarios:
//   queued   — B (image+caption) is idle-rejected, resubmitted behind another
//              client's prompt C, its first confirming refresh is aborted;
//              a possibly-ours prompt D arrives during the window.
//   delete   — same as `queued`, then try to Delete the B row.
//   immediate— the issue's shape: no C, B starts right after resubmission.
//   settle   — like `queued`, but EVERY pending-prompts GET fails until B
//              settles, so no snapshot can ever list B (settle-drop path).
//   file     — `queued` with a pasted text file instead of an image.
//   control  — no B at all: a possibly-ours prompt D queued behind turn A.
// Only network-level injection is used; neither the app nor the daemon is
// modified.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/root/pr12279/');
const { chromium } = require('playwright-core');

const [arm, port, scenario, outArg] = process.argv.slice(2);
const R = '/root/pr12279';
const token = fs.readFileSync(`${R}/run/${arm}.token`, 'utf8').trim();
const base = `http://127.0.0.1:${port}`;
const outDir = outArg ?? `${R}/out/${arm}-${scenario}`;
fs.mkdirSync(outDir, { recursive: true });
const T0 = Date.now();
const timeline = [];
const log = (kind, detail = {}) => {
  const e = { t: Date.now() - T0, kind, ...detail };
  timeline.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCEN = {
  queued: { b: 'image', c: true, d: true, abort: 'once' },
  file: { b: 'file', c: true, d: true, abort: 'once' },
  delete: { b: 'image', c: true, d: false, abort: 'once', del: true },
  immediate: { b: 'image', c: false, d: false, abort: 'once' },
  settle: { b: 'image', c: true, d: false, abort: 'until-b-settles' },
  control: { b: null, c: false, d: true, abort: 'none' },
}[scenario];
if (!SCEN) throw new Error(`unknown scenario ${scenario}`);
const CAPTION = scenario === 'immediate'
  ? 'describe this caption [slow:8]'
  : 'describe this caption [slow:2]';

async function daemon(p, init = {}) {
  const res = await fetch(`${base}${p}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
const pending = async (sid) =>
  (await daemon(`/session/${sid}/pending-prompts`)).json.pendingPrompts ?? [];
const brief = (list) =>
  list.map((p) => `${p.state}:${p.text.slice(0, 28)}:${p.originatorClientId ? 'cid' : 'nocid'}`);
async function submitForeign(sid, text) {
  const r = await daemon(`/session/${sid}/prompt`, {
    method: 'POST',
    body: JSON.stringify({ prompt: [{ type: 'text', text }] }),
  });
  log('foreign.submit', { text, status: r.status, promptId: r.json?.promptId });
  return r.json?.promptId;
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') log('console.error', { text: m.text().slice(0, 300) });
});
page.on('pageerror', (e) => log('pageerror', { text: String(e).slice(0, 300) }));

let sid;
let armResubmit = false;
let abortArmed = false;
let abortsLeft = SCEN.abort === 'until-b-settles' ? Infinity : SCEN.abort === 'once' ? 1 : 0;
let bPromptId;
let bAcceptedAt;
let bSettled = false;
const netTracked = /\/session\/[^/]+\/(prompt|pending-prompts|mid-turn-message|attachments|pending-prompts\/[^/]+)$/;
page.on('request', (req) => {
  const u = new URL(req.url());
  const m = /\/session\/([^/]+)\/prompt$/.exec(u.pathname);
  if (m && req.method() === 'POST' && !sid) sid = decodeURIComponent(m[1]);
  if (netTracked.test(u.pathname))
    log('net.req', { method: req.method(), path: u.pathname.replace(/\/session\/[^/]+/, '/session/:id') });
});
page.on('response', async (res) => {
  const u = new URL(res.url());
  if (!netTracked.test(u.pathname)) return;
  let body;
  if (/mid-turn-message$|\/prompt$/.test(u.pathname)) {
    try {
      body = JSON.stringify(await res.json()).slice(0, 200);
    } catch {}
  }
  log('net.res', {
    method: res.request().method(),
    path: u.pathname.replace(/\/session\/[^/]+/, '/session/:id'),
    status: res.status(),
    ...(body ? { body } : {}),
  });
});
page.on('requestfailed', (req) => {
  const u = new URL(req.url());
  if (netTracked.test(u.pathname))
    log('net.failed', { method: req.method(), path: u.pathname.replace(/\/session\/[^/]+/, '/session/:id'), error: req.failure()?.errorText });
});

async function queueRows() {
  return await page.$$eval('[data-web-shell-queued-prompts] > div', (rows) =>
    rows
      .filter((r) => r.querySelector('button[aria-label="Delete"], [class*="queuedPromptText"]'))
      .map((r) => ({
        text: (r.querySelector('[class*="queuedPromptText"]')?.textContent ?? '').trim(),
        state: (r.querySelector('[role="status"]')?.textContent ?? '').trim() || null,
        deleteDisabled: r.querySelector('button[aria-label="Delete"]')?.disabled ?? null,
        editDisabled: r.querySelector('button[aria-label="Edit"]')?.disabled ?? null,
        images: r.querySelectorAll('img').length,
      })),
  );
}
async function shot(name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  log('shot', { file });
}
async function transcriptCount(needle) {
  // Occurrences of the (case-sensitive) needle in rendered text, minus those
  // inside the queue panel and the composer. The fake model upper-cases what
  // it echoes, so assistant replies never match.
  return await page.evaluate((needle) => {
    const count = (el) => (el ? el.innerText.split(needle).length - 1 : 0);
    return (
      count(document.body) -
      count(document.querySelector('[data-web-shell-queued-prompts]')) -
      count(document.querySelector('.cm-content'))
    );
  }, needle);
}

// ---- routes (network-level injection only) ----
await page.route(
  (url) => url.pathname.endsWith('/mid-turn-message'),
  async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    log('inject.midturn.hold', { note: 'holding mid-turn insert until turn A settles' });
    for (;;) {
      const list = await pending(sid);
      if (list.length === 0) break;
      await sleep(100);
    }
    await sleep(400);
    armResubmit = true;
    log('inject.midturn.release', { note: 'turn A settled; daemon FIFO empty' });
    await route.continue();
  },
);
await page.route(
  (url) => /\/session\/[^/]+\/prompt$/.test(url.pathname),
  async (route) => {
    if (route.request().method() !== 'POST' || !armResubmit) return route.continue();
    armResubmit = false;
    let cId;
    if (SCEN.c) {
      log('inject.resubmit.hold', { note: 'holding B resubmission; a second client submits C first' });
      cId = await submitForeign(sid, '[slow:12] prompt C from a second client');
      for (;;) {
        const list = await pending(sid);
        if (list.some((p) => p.promptId === cId && p.state === 'running')) break;
        await sleep(100);
      }
      log('inject.resubmit.release', { note: 'C is running; B will queue behind it' });
    }
    const response = await route.fetch();
    const json = await response.json();
    bPromptId = json.promptId;
    bAcceptedAt = Date.now() - T0;
    abortArmed = true;
    log('inject.resubmit.accepted', { status: response.status(), promptId: bPromptId, daemon: brief(await pending(sid)) });
    await route.fulfill({ response, json });
  },
);
await page.route(
  (url) => url.pathname.endsWith('/pending-prompts'),
  async (route) => {
    if (abortArmed && abortsLeft > 0 && !bSettled) {
      abortsLeft -= 1;
      log('inject.pending.abort', { left: abortsLeft });
      return route.abort('failed');
    }
    return route.continue();
  },
);

// ---- flow ----
await page.goto(`${base}/?token=${token}&language=en`);
await page.locator('.cm-content').waitFor({ timeout: 60000 });
await sleep(1500);
await page.locator('.cm-content').click();
await page.locator('.cm-content').pressSequentially('[slow:6] turn A: first turn');
await page.keyboard.press('Enter');
for (let i = 0; i < 300 && !sid; i++) await sleep(100);
log('session', { sid });
for (;;) {
  const list = await pending(sid);
  if (list.some((p) => p.state === 'running')) break;
  await sleep(100);
}
log('turnA.running');
await sleep(1200);

if (SCEN.b) {
// Paste an attachment (a real ClipboardEvent through the composer's paste path)
await page.locator('.cm-content').click();
await page.evaluate(async (kind) => {
  let file;
  if (kind === 'image') {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#2f81f7';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#ffffff';
    g.font = 'bold 22px sans-serif';
    g.fillText('B-IMG', 12, 40);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    file = new File([blob], 'probe.png', { type: 'image/png' });
  } else {
    file = new File(['notes attached to B\nline two\n'], 'b-notes.txt', { type: 'text/plain' });
  }
  const dt = new DataTransfer();
  dt.items.add(file);
  document
    .querySelector('.cm-content')
    .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, SCEN.b);
await sleep(800);
await page.locator('.cm-content').pressSequentially(CAPTION);
await sleep(300);
log('B.enqueue', { caption: CAPTION, kind: SCEN.b, rowsBefore: await queueRows() });
await page.keyboard.press('Enter');

// Wait for the resubmission to be accepted
for (let i = 0; i < 600 && !bAcceptedAt; i++) await sleep(100);
if (!bAcceptedAt) log('ERROR.no-resubmission');
} else {
  bAcceptedAt = Date.now() - T0;
}

// ---- observe ----
const samples = [];
let dSubmitted = false;
let deleteTried = false;
let shots = new Set();
const deadline = Date.now() + 70000;
let lastKey = '';
while (Date.now() < deadline) {
  const since = Date.now() - T0 - (bAcceptedAt ?? 0);
  const rows = await queueRows();
  const list = sid ? await pending(sid) : [];
  const key = JSON.stringify(rows) + JSON.stringify(brief(list));
  if (key !== lastKey) {
    log('sample', { sinceAccept: since, rows, daemon: brief(list) });
    lastKey = key;
  }
  samples.push({ sinceAccept: since, rows, daemon: brief(list) });
  if (bPromptId && !list.some((p) => p.promptId === bPromptId) && since > 1500) bSettled = true;
  if (since > 1500 && !shots.has('01')) {
    shots.add('01');
    await shot('01-after-refresh-failure');
  }
  if (SCEN.d && since > (SCEN.b ? 2500 : 500) && !dSubmitted) {
    dSubmitted = true;
    await submitForeign(sid, '[slow:1] prompt D from a third client');
  }
  if (dSubmitted && since > 4500 && !shots.has('02')) {
    shots.add('02');
    await shot('02-possibly-ours-D');
  }
  if (SCEN.del && since > 5000 && !deleteTried) {
    deleteTried = true;
    const rowsNow = await queueRows();
    const bRow = rowsNow.findIndex((r) => r.text.includes('describe this caption'));
    const btn = page
      .locator('[data-web-shell-queued-prompts] > div')
      .filter({ hasText: 'describe this caption' })
      .locator('button[aria-label="Delete"]');
    const disabled = (await btn.count()) ? await btn.isDisabled() : null;
    log('delete.try', { bRowIndex: bRow, disabled });
    if (disabled === false) {
      await btn.click();
      log('delete.clicked');
      await sleep(1500);
      await shot('03-after-delete');
    } else {
      await shot('03-delete-disabled');
    }
  }
  const idle = list.length === 0 && rows.length === 0 && since > 6000 && (!SCEN.d || dSubmitted);
  if (idle) break;
  await sleep(250);
}
await sleep(1500);
await shot('09-final');
const final = {
  arm,
  scenario,
  bPromptId,
  bAcceptedAt,
  finalRows: await queueRows(),
  daemonFinal: brief(await pending(sid)),
  transcriptCaptionCount: await transcriptCount('describe this caption'),
  transcriptDCount: await transcriptCount('prompt D from a third client'),
};
// Reload the session: does the persisted transcript carry what the live view showed?
await page.goto(`${base}/session/${encodeURIComponent(sid)}?token=${token}&language=en`);
await page.locator('.cm-content').waitFor({ timeout: 60000 });
await sleep(4000);
final.afterReloadCaptionCount = await transcriptCount('describe this caption');
final.afterReloadDCount = await transcriptCount('prompt D from a third client');
await shot('10-after-reload');
log('final', final);
fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ final, timeline, samples }, null, 1));
await browser.close();
