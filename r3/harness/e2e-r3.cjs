// PR #12234 round 3 — probes aimed at code added after round 2
// (6fd5e61 live echo de-dup, 9826676 animation-frame snapshot + streaming
// identity, 0c73062 reconnect cancellation). Real daemon, no mocks; the only
// network intervention is an optional *delay* on /transcript in N5.
const { chromium } = require('playwright');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const BASE = 'http://127.0.0.1:14234';
const TOKEN = 'verify-token-12234';
const WS = '/private/var/tmp/pr12234-r3/ws';
const SHOTS = __dirname + '/shots';
const LONG = require('./seed-long.json').sessionId;
const ONLY = process.env.ONLY?.split(',');
const results = [];
const check = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const searchButton = (page) => page.getByRole('button', { name: /^Search this conversation$/ });
const dialogOf = (page) => page.locator('[data-conversation-search]');

async function newSession() {
  const r = await fetch(`${BASE}/session`, { method: 'POST', headers: auth, body: JSON.stringify({ cwd: WS, sessionScope: 'thread' }) });
  return (await r.json()).sessionId;
}
async function open(browser, sessionId) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/session/${sessionId}?token=${TOKEN}`);
  await page.locator('[data-web-shell-composer-editor] .cm-content').waitFor({ timeout: 30000 });
  return { ctx, page, errors };
}
async function type(page, text) {
  await page.locator('[data-web-shell-composer-editor] .cm-content').click();
  await page.keyboard.type(text);
  await page.locator('[data-web-shell-composer-submit]').click();
}
async function send(page, text, waitFor) {
  await type(page, text);
  await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
}
async function settled(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-conversation-search] [role=status]');
    return el && !/Searching/.test(el.textContent ?? '');
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(300);
}
async function query(page, text) {
  if ((await dialogOf(page).count()) === 0) await searchButton(page).click();
  await dialogOf(page).locator('input').fill(text);
  await settled(page);
  return rows(page);
}
async function rows(page) {
  const d = dialogOf(page);
  return {
    status: (await d.locator('[role=status]').textContent().catch(() => ''))?.trim(),
    rows: (await d.getByRole('option').allTextContents()).map((t) => t.replace(/\s+/g, ' ').slice(0, 80)),
  };
}
const entryVisible = async (page) => (await searchButton(page).count()) === 1 && (await searchButton(page).isVisible());
const close = async (page) => { if (await dialogOf(page).count()) await page.keyboard.press('Escape'); };

async function reload(page, waitFor) {
  await page.reload();
  await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
}

(async () => {
  const browser = await chromium.launch();

  // N1 — a reply that streams for ~8 s while the dialog is open.
  if (!ONLY || ONLY.includes('stream')) {
    const sid = await newSession();
    const { page, errors } = await open(browser, sid);
    for (let k = 1; k <= 6; k++) await send(page, `Question #${k}: tell me about topic-${k}`, `Answer #${k}:`);
    await type(page, 'Question #30: SLOWSTREAM please stream this one');
    await page.getByText('Answer #30', { exact: false }).first().waitFor({ timeout: 30000 });
    await searchButton(page).click();
    await dialogOf(page).locator('input').fill('KESTREL');
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 14000) {
      const r = await rows(page);
      samples.push({ t: Date.now() - t0, n: r.rows.length, status: r.status });
      await page.waitForTimeout(250);
    }
    const maxRows = Math.max(...samples.map((s) => s.n));
    const final = await rows(page);
    check('N1a', 'mid-stream samples never list the streaming reply twice', maxRows <= 1, { maxRows, distinct: [...new Set(samples.map((s) => `${s.n}:${s.status}`))] });
    check('N1b', 'after the stream settles with the dialog still open: exactly 1 row', final.rows.length === 1, final);
    const tail = await query(page, 'STREAMED-TAIL-KESTREL');
    check('N1c', 'text from the LAST streamed chunk is found (dialog stayed open)', tail.rows.length === 1, tail);
    await page.screenshot({ path: `${SHOTS}/r3-n1-stream-settled.png` });
    const user = await query(page, 'SLOWSTREAM');
    check('N1d', 'the streamed turn\'s user prompt is listed once', user.rows.length === 1, user);
    await close(page);
    await reload(page, 'Answer #30');
    const after = await query(page, 'KESTREL');
    check('N1e', 'after reload: still exactly 1 row (live == replay)', after.rows.length === 1, after);
    check('N1f', 'no uncaught page errors', errors.length === 0, errors);
    fs.writeFileSync(__dirname + '/samples-n1.json', JSON.stringify(samples, null, 1));
    await page.context().close();
  }

  // N2 — threshold counting on tool-call turns, typed live vs. after reload.
  if (!ONLY || ONLY.includes('toolcount')) {
    const sid = await newSession();
    const { page, errors } = await open(browser, sid);
    const table = [];
    const steps = [
      ['Question #51: TOOLCALL inspect', 'POST-TOOL-NEEDLE-ORCHID'],
      ['Question #52: TOOLCALL inspect', 'POST-TOOL-NEEDLE-ORCHID'],
      ['Question #53: TOOLCALL inspect', 'POST-TOOL-NEEDLE-ORCHID'],
      ['Question #54: tell me about topic-54', 'Answer #54:'],
    ];
    for (const [i, [text, waitFor]] of steps.entries()) {
      const before = await page.getByText(waitFor, { exact: false }).count();
      await type(page, text);
      await page.waitForFunction(([w, n]) => (document.querySelector('[data-web-shell-message-list]')?.textContent.split(w).length - 1) > n, [waitFor, before], { timeout: 60000 });
      await page.waitForTimeout(3000);
      const live = await entryVisible(page);
      await reload(page, waitFor);
      const replay = await entryVisible(page);
      const transcript = await (await fetch(`${BASE}/session/${sid}/transcript?limit=200`, { headers: auth })).json().catch(() => null);
      table.push({ step: i + 1, live, replay });
    }
    // Ground truth from disk: persisted user/assistant messages with text.
    const file = execFileSync('bash', ['-c', `ls /var/tmp/pr12234-r3/rt/projects/*/chats/${sid}.jsonl`]).toString().trim();
    const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const txt = (r) => (r.message?.parts ?? []).map((p) => p.text ?? '').join('');
    const persisted = recs.filter((r) => (r.type === 'user' || r.type === 'assistant') && r.message && txt(r).trim()).length;
    check('N2a', 'entry visibility typed-live == after-reload at every step', table.every((r) => r.live === r.replay), { table, persistedTextMessages: persisted });
    check('N2b', 'no uncaught page errors', errors.length === 0, errors);
    await page.context().close();
  }

  // N2c — the same three tool turns, all typed live with NO reload in between.
  if (!ONLY || ONLY.includes('toollive')) {
    const sid = await newSession();
    const { page, errors } = await open(browser, sid);
    const seen = [];
    for (const n of [61, 62, 63]) {
      const before = await page.getByText('POST-TOOL-NEEDLE-ORCHID', { exact: false }).count();
      await type(page, `Question #${n}: TOOLCALL inspect`);
      await page.waitForFunction((c) => (document.querySelector('[data-web-shell-message-list]')?.textContent.split('POST-TOOL-NEEDLE-ORCHID').length - 1) > c, before, { timeout: 60000 });
      await page.waitForTimeout(3000);
      seen.push(await entryVisible(page));
    }
    await page.screenshot({ path: `${SHOTS}/r3-n2c-three-tool-turns-live-${process.env.ARM ?? 'x'}.png` });
    const liveAt9 = seen[2];
    await send(page, 'Question #64: tell me about topic-64', 'Answer #64:');
    const liveAt11 = await entryVisible(page);
    check('N2c', 'three tool turns typed live (9 messages): hidden; one more turn (11): shown', !seen.some(Boolean) && liveAt11, { seen, liveAt9, liveAt11 });
    const pre = await query(page, 'PRE-TOOL-NEEDLE');
    check('N2d', 'three live pre-tool segments: 3 rows (no twins)', pre.rows.length === 3, pre);
    await page.screenshot({ path: `${SHOTS}/r3-n2d-pre-tool-rows-live-${process.env.ARM ?? 'x'}.png` });
    check('N2e', 'no uncaught page errors', errors.length === 0, errors);
    await page.context().close();
  }

  // N3/N4 — identical text typed live twice (user text, and pre-tool assistant text).
  if (!ONLY || ONLY.includes('identical')) {
    const sid = await newSession();
    const { page, errors } = await open(browser, sid);
    for (let k = 1; k <= 6; k++) await send(page, `Question #${k}: tell me about topic-${k}`, `Answer #${k}:`);
    await send(page, 'Question #40: identical-probe', 'Answer #40:');
    await send(page, 'Question #40: identical-probe', 'Answer #40:');
    await page.waitForFunction(() => (document.querySelector('[data-web-shell-message-list]')?.textContent.split('Answer #40:').length - 1) >= 2, undefined, { timeout: 60000 });
    await send(page, 'Question #41: TOOLCALL first', 'POST-TOOL-NEEDLE-ORCHID');
    await send(page, 'Question #41: TOOLCALL second', 'Question #41: TOOLCALL second');
    await page.waitForFunction(() => (document.querySelector('[data-web-shell-message-list]')?.textContent.split('POST-TOOL-NEEDLE-ORCHID').length - 1) >= 2, undefined, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const live = {
      user: (await query(page, 'identical-probe')).rows.length,
      answer: (await query(page, 'Answer #40')).rows.length,
      pre: (await query(page, 'PRE-TOOL-NEEDLE')).rows.length,
      post: (await query(page, 'POST-TOOL-NEEDLE')).rows.length,
    };
    await page.screenshot({ path: `${SHOTS}/r3-n4-identical-pre-tool-live.png` });
    await close(page);
    await reload(page, 'Question #41: TOOLCALL second');
    const replay = {
      user: (await query(page, 'identical-probe')).rows.length,
      answer: (await query(page, 'Answer #40')).rows.length,
      pre: (await query(page, 'PRE-TOOL-NEEDLE')).rows.length,
      post: (await query(page, 'POST-TOOL-NEEDLE')).rows.length,
    };
    const expected = { user: 2, answer: 2, pre: 2, post: 2 };
    check('N3', 'identical user text + identical reply typed twice: 2 rows each, live and after reload', live.user === 2 && live.answer === 2 && replay.user === 2 && replay.answer === 2, { live, replay, expected });
    check('N4', 'identical pre-/post-tool assistant text in two live tool turns: 2 rows each, live and after reload', live.pre === 2 && live.post === 2 && replay.pre === 2 && replay.post === 2, { live, replay, expected });
    check('N3e', 'no uncaught page errors', errors.length === 0, errors);
    await page.context().close();
  }

  // N5 — daemon restarts while a deep-history navigation is in flight.
  if (!ONLY || ONLY.includes('reconnect')) {
    const { page, errors } = await open(browser, LONG);
    await page.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    let armed = false;
    const delayed = [];
    await page.route(/\/transcript(\?|$)/, async (route) => {
      if (!armed) return route.continue();
      delayed.push(Date.now());
      await new Promise((r) => setTimeout(r, 7000));
      route.continue().catch(() => {});
    });
    const r = await query(page, 'zebra-quartz-7731');
    armed = true;
    await dialogOf(page).getByRole('option').first().click();
    await page.waitForTimeout(800);
    const pid = fs.readFileSync('/var/tmp/pr12234-r3/daemon.pid', 'utf8').trim();
    execFileSync('kill', [pid]);
    await page.waitForTimeout(1500);
    execFileSync('tmux', ['-L', 'pr12234r3', 'kill-window', '-t', 'main:daemon']);
    execFileSync('tmux', ['-L', 'pr12234r3', 'new-window', '-t', 'main', '-n', 'daemon', `env -i PATH=${process.env.PATH} /var/tmp/pr12234-r3/harness/start-daemon.sh 14234 2>&1 | tee -a /var/tmp/pr12234-r3/daemon.log`]);
    for (let i = 0; i < 30; i++) {
      const ok = await fetch(`${BASE}/health`).then((x) => x.ok).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(1000);
    }
    armed = false;
    // let the delayed request(s) complete against the restarted daemon, and the client reconnect
    await page.waitForTimeout(12000);
    const state = await page.evaluate(() => ({
      viewport: document.querySelector('[data-history-viewport]')?.getAttribute('data-history-viewport'),
      turn3Visible: /Answer #3: common-token/.test(document.querySelector('[data-web-shell-message-list]')?.textContent ?? ''),
      answer600Visible: /Answer #600:/.test(document.querySelector('[data-web-shell-message-list]')?.textContent ?? ''),
      flash: document.querySelector('[class*="flash"]')?.textContent?.slice(0, 60) ?? null,
      dialogOpen: !!document.querySelector('[data-conversation-search]'),
      rail: document.querySelectorAll('[data-global-turn-navigation]').length,
      railHidden: !!document.querySelector('[data-global-turn-navigation]')?.closest('[hidden]'),
      search: document.querySelectorAll('button[aria-label="Search this conversation"]').length,
      url: location.pathname.slice(0, 60),
      alerts: [...document.querySelectorAll('[role=alert]')].map((n) => n.textContent.slice(0, 120)),
    }));
    await page.screenshot({ path: `${SHOTS}/r3-n5-after-reconnect.png` });
    check('N5a', 'navigation started before the restart was held (delayed /transcript observed)', delayed.length >= 1 && r.rows.length === 1, { delayed: delayed.length, hit: r.rows });
    check('N5b', 'after reconnect the stale navigation did not land on turn #3 later', !state.turn3Visible || state.viewport === 'live', state);
    // A fresh search + navigation after the reconnect must work end to end.
    await page.unroute(/\/transcript(\?|$)/);
    await close(page);
    // The restart drops the page back to '/', so reopen the session like a user would.
    await page.goto(`${BASE}/session/${LONG}?token=${TOKEN}`);
    await page.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 60000 });
    await searchButton(page).waitFor({ timeout: 20000 });
    await searchButton(page).click({ timeout: 15000 });
    const again = await query(page, 'zebra-quartz-7731');
    await dialogOf(page).getByRole('option').first().click();
    const flash = page.locator('[class*="flash"]').first();
    await flash.waitFor({ timeout: 20000 }).catch(() => {});
    const flashed = (await flash.textContent().catch(() => null))?.slice(0, 60) ?? null;
    check('N5c', 'after reconnect a new search + navigation lands on turn #3', again.rows.length === 1 && /Answer #3:/.test(flashed ?? ''), { again, flashed });
    await page.screenshot({ path: `${SHOTS}/r3-n5-renavigate.png` });
    check('N5d', 'no uncaught page errors', errors.length === 0, errors);
    await page.context().close();
  }

  await browser.close();
  const tag = process.env.TAG ?? '';
  fs.writeFileSync(`${__dirname}/results-r3${tag}.json`, JSON.stringify(results, null, 1));
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch((e) => { console.error('HARNESS ERROR', e); fs.writeFileSync(`${__dirname}/results-r3-partial.json`, JSON.stringify(results, null, 1)); process.exit(2); });
