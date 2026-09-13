// PR #11748 real-stack E2E: a real `qwen serve` serving a built Web Shell arm,
// driven in real Chromium, with a real PTY + bash.
//
// SCEN=decrqm  — mode queries in the live terminal. Oracle: query-emit.cjs logs
//                the reply bytes that actually reach the PTY's stdin, plus what
//                the terminal renders afterwards and after a page reload.
// SCEN=legacy  — this Web Shell against a daemon that predates the replay
//                protocol. Oracle: frames the browser sends on /terminal, the
//                close code, the notice text, and shells alive under the daemon
//                before/after the mismatch and after closing the tab.
//
// env: ARM URL OUT SCEN DPID
const { chromium } = require('/root/git/pr11748-harness/head/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const ARM = process.env.ARM;
const URL_ = process.env.URL;
const OUT = process.env.OUT;
const SCEN = process.env.SCEN;
const DPID = Number(process.env.DPID ?? 0);
const EMIT = path.join(__dirname, 'query-emit.cjs');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull the EN and ZH strings for a key straight from the built tree's i18n.tsx.
const I18N = fs.readFileSync('/root/git/pr11748-harness/head/packages/web-shell/client/i18n.tsx', 'utf8');
function labels(key) {
  const re = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'([^']*)'`, 'g');
  return [...I18N.matchAll(re)].map((m) => m[1]);
}
const anyOf = (key) => new RegExp(labels(key).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));

function shellsUnder(root) {
  if (!root) return null;
  const par = {};
  const comm = {};
  for (const p of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(p)) continue;
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8');
      const m = st.match(/^\d+ \((.*)\) \S+ (\d+)/);
      par[p] = Number(m[2]);
      comm[p] = m[1];
    } catch {}
  }
  const pids = [];
  for (const p of Object.keys(par)) {
    if (comm[p] !== 'bash') continue;
    let q = Number(p);
    while (q > 1) {
      q = par[q];
      if (q === root) {
        pids.push(Number(p));
        break;
      }
    }
  }
  return pids;
}
async function waitFor(fn, timeout = 30000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return undefined;
}
const readLog = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

(async () => {
  const result = { arm: ARM, url: URL_, scen: SCEN, steps: {}, pageErrors: [], consoleErrors: [] };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.pageErrors.push({ t: Date.now(), e: String(e).slice(0, 300) }));
  page.on('console', (m) => {
    if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 300));
  });
  const sockets = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/terminal')) return;
    const u = new URL(ws.url());
    const rec = {
      openedAt: Date.now(),
      release: u.searchParams.get('release'),
      replay: u.searchParams.get('replay'),
      sent: [],
      received: [],
      binFramesReceived: 0,
      firstBinAt: null,
    };
    sockets.push(rec);
    ws.on('framesent', (f) => {
      const p = f.payload;
      rec.sent.push({ t: Date.now(), kind: typeof p === 'string' ? 'text' : 'binary', text: typeof p === 'string' ? p.replace(/\x00/g, '\\0').slice(0, 200) : `${p.length} bytes` });
    });
    ws.on('framereceived', (f) => {
      const p = f.payload;
      if (typeof p === 'string') rec.received.push({ t: Date.now(), text: p.replace(/\x00/g, '\\0').slice(0, 200) });
      else {
        rec.binFramesReceived++;
        rec.firstBinAt ??= Date.now();
      }
    });
    ws.on('close', () => (rec.closedAt = Date.now()));
  });
  await context.addInitScript(() => {
    const Orig = window.WebSocket;
    window.__wsLog = [];
    class Logged extends Orig {
      constructor(u, p) {
        super(u, p);
        const e = { url: String(u), t: Date.now() };
        window.__wsLog.push(e);
        this.addEventListener('close', (ev) => {
          e.code = ev.code;
          e.reason = ev.reason;
        });
      }
    }
    window.WebSocket = Logged;
  });

  const term = () => page.locator('[data-web-terminal]').first();
  const rowsText = () =>
    page.evaluate(() =>
      [...(document.querySelector('[data-web-terminal] .xterm-rows')?.children ?? [])].map((r) => r.textContent).join('\n'),
    );
  const focusTerm = async () => page.locator('[data-web-terminal] .xterm-screen').first().click();
  const typeLine = async (s) => {
    await focusTerm();
    await page.keyboard.type(s, { delay: 2 });
    await page.keyboard.press('Enter');
  };
  const shot = async (name) => term().screenshot({ path: path.join(OUT, `${name}.png`) });
  const wsLog = () =>
    page.evaluate(() => window.__wsLog.filter((e) => e.url.includes('/terminal')).map((e) => ({ code: e.code, reason: e.reason, release: new URL(e.url).searchParams.get('release') })));
  const save = () => fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));

  try {
    await page.goto(`${URL_}/`);
    await page.locator('[data-web-shell-composer-editor] .cm-content').first().click({ timeout: 45000 });
    await page.keyboard.type('hello');
    await page.locator('[data-web-shell-composer-submit]').first().click();
    await sleep(1500);
    result.steps.shellsBeforeOpen = shellsUnder(DPID);
    await page.getByRole('button', { name: anyOf('chatHeader.toggleRightPanel') }).first().click({ timeout: 30000 });
    await page.getByRole('button', { name: anyOf('terminal.open') }).first().click({ timeout: 30000 });
    await page.locator('[data-web-terminal] .xterm').first().waitFor({ timeout: 30000 });

    if (SCEN === 'decrqm') {
      await waitFor(async () => (await rowsText()).includes('$'), 20000);
      await sleep(800);
      const log = path.join(OUT, 'replies.jsonl');
      fs.rmSync(log, { force: true });
      const r = (result.steps.decrqm = { runs: [] });
      for (const which of ['da1', 'decrqm-private', 'decrqm-ansi', 'decrqm-2004']) {
        const before = readLog(log).length;
        const errs = result.pageErrors.length;
        await typeLine(`node ${EMIT} ${log} ${which}`);
        await waitFor(() => readLog(log).length > before, 10000);
        await sleep(600);
        const rec = readLog(log).at(-1);
        const rows = await rowsText();
        const tag = which.toUpperCase();
        r.runs.push({
          which,
          replyBytesAtPty: rec?.replyBytes ?? null,
          replyText: rec?.replyText ?? null,
          renderedSameWriteMarker: rows.includes(`AFTER-${tag}-SAME-WRITE`),
          renderedReplyCountLine: rows.includes(`REPLY-BYTES-${tag}=`),
          newPageErrors: result.pageErrors.slice(errs).map((e) => e.e),
        });
      }
      await typeLine('echo LATER-OUTPUT-$((7*7))');
      await sleep(1500);
      r.laterOutputRendered = (await rowsText()).includes('LATER-OUTPUT-49');
      r.rowsLive = (await rowsText()).trim().split('\n').filter(Boolean).slice(0, 14);
      await shot('decrqm-live');
      const n = sockets.length;
      await page.reload();
      await page.locator('[data-web-terminal] .xterm').first().waitFor({ timeout: 30000 }).catch(() => {});
      const s = await waitFor(() => sockets.slice(n).find((x) => x.firstBinAt), 30000, 20);
      await sleep(4000);
      r.reloadReconnected = !!s;
      r.snapshotControlAfterReload = s?.received.map((c) => c.text) ?? null;
      r.rowsAfterReload = (await rowsText()).trim().split('\n').filter(Boolean).slice(0, 14);
      await shot('decrqm-reload');
      await typeLine('echo POST-RELOAD-$((8*8))').catch((e) => (r.postReloadTypeError = String(e).slice(0, 200)));
      await sleep(2000);
      r.postReloadOutputRendered = (await rowsText()).includes('POST-RELOAD-64');
      r.xtermElementsAfterReload = await page.evaluate(() => document.querySelectorAll('[data-web-terminal] .xterm').length);
      await shot('decrqm-post-reload');
    } else if (SCEN === 'legacy') {
      const r = (result.steps.legacy = {});
      await waitFor(async () => (await wsLog()).some((e) => e.code !== undefined), 20000);
      await sleep(2500);
      r.shellsAfterMismatch = shellsUnder(DPID);
      r.wsLogAfterMismatch = await wsLog();
      r.socketsAfterMismatch = JSON.parse(JSON.stringify(sockets));
      r.rows = (await rowsText()).trim().split('\n').filter(Boolean);
      await shot('legacy-mismatch');
      // Close the terminal tab; a head client already released and must not
      // open a release-only socket or send another release.
      const n = sockets.length;
      const sentBefore = sockets.reduce((a, s) => a + s.sent.length, 0);
      // ArtifactPanel tab close: aria-label={`Close ${tab.title}`}, title = t('terminal.title').
      const closeBtn = page
        .getByRole('button', { name: new RegExp(`^Close (${labels('terminal.title').join('|')})`) })
        .first();
      r.closeButtonFound = (await closeBtn.count()) > 0;
      if (r.closeButtonFound) await closeBtn.click({ timeout: 10000 });
      await sleep(3000);
      r.newSocketsAfterClose = sockets.slice(n).map((s) => ({ release: s.release, sent: s.sent }));
      r.framesSentAfterClose = sockets.reduce((a, s) => a + s.sent.length, 0) - sentBefore;
      r.shellsAfterClose = shellsUnder(DPID);
      r.wsLogAfterClose = await wsLog();
    }
  } catch (e) {
    result.error = String(e?.stack ?? e).slice(0, 1500);
    await page.screenshot({ path: path.join(OUT, 'error-page.png') }).catch(() => {});
  }
  save();
  console.log('DONE', ARM, SCEN, result.error ? 'ERROR' : 'ok');
  await browser.close();
})();
