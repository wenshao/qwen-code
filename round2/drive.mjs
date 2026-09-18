/**
 * Playwright driver for the PR #11251 round-2 re-verification.
 *
 * Replaces the Chrome-extension driver used in round 1 (its keyboard injection
 * died mid-run). Drives the real embedding host against the real daemon and
 * reports, for each Reviewer Test Plan item, the payloads the host received.
 */
import { chromium } from 'playwright';

const HOST = process.env.HOST_URL ?? 'http://127.0.0.1:5351';
const PROXY = process.env.PROXY_URL ?? 'http://127.0.0.1:4352';
const FAKE = process.env.FAKE_URL ?? 'http://127.0.0.1:5091';

const log = (...parts) => console.log(...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctl(body) {
  const res = await fetch(`${FAKE}/__ctl`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function px(action) {
  const res = await fetch(`${PROXY}/__px`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return res.json();
}

async function settlements(page) {
  return page.evaluate(() => window.__probe?.settlements ?? []);
}
async function sessionChanges(page) {
  return page.evaluate(() =>
    (window.__probe?.sessionChanges ?? []).map((c) => c.type),
  );
}

async function submit(page, text) {
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible', timeout: 60_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 8 });
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.cm-content')?.innerText?.includes(expected),
    text,
    { timeout: 20_000 },
  );
  await page.keyboard.press('Enter');
}

async function waitForSettlements(page, n, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await settlements(page);
    if (list.length >= n) return list;
    await sleep(500);
  }
  return settlements(page);
}

async function openHost(browser, query = '') {
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('[PROBE')) log('   browser:', text);
  });
  await page.goto(`${HOST}/?daemon=${PROXY}${query}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(window.__probe), { timeout: 60_000 });
  return page;
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

const browser = await chromium.launch({ headless: true });
try {
  // ---- 1. completed -------------------------------------------------------
  await ctl({ mode: 'complete', answer: 'The real answer for this turn.' });
  let page = await openHost(browser);
  await submit(page, 'A completed turn');
  let list = await waitForSettlements(page, 1);
  const completed = list[0];
  record(
    'completed turn',
    completed?.outcome === 'completed' &&
      completed?.stopReason === 'end_turn' &&
      completed?.message?.content === 'The real answer for this turn.' &&
      completed?.message?.isStreaming === false,
    JSON.stringify(completed),
  );
  const changes = await sessionChanges(page);
  record(
    'onSessionChange unchanged (turn_complete still fires)',
    changes.includes('turn_complete'),
    `sessionChange types: ${JSON.stringify(changes)}`,
  );
  const sessionOne = completed?.sessionId;

  // ---- 2. cancelled -------------------------------------------------------
  await ctl({ mode: 'hang' });
  await submit(page, 'A cancelled turn');
  await sleep(6000);
  // Round 1 noted that Escape did not cancel in an embedded host; re-check it
  // with a real keyboard driver before falling back to the stop control.
  await page.keyboard.press('Escape');
  await sleep(4000);
  const cancelledByEscape = (await settlements(page)).length >= 2;
  log('   escape cancelled the turn:', cancelledByEscape);
  const stop = cancelledByEscape
    ? page.locator('button[aria-label="never-matches"]')
    : page.locator('button[aria-label="esc to cancel"]');
  if ((await stop.count()) > 0) {
    await stop.first().click();
  } else {
    // The send control turns into the stop control while a turn is in flight.
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .map((b) => b.getAttribute('aria-label'))
        .filter(Boolean),
    );
    log('   stop-button labels seen:', JSON.stringify(labels));
    log('   no stop control found');
  }
  list = await waitForSettlements(page, 2);
  const cancelled = list[1];
  record(
    'cancelled turn',
    cancelled?.outcome === 'cancelled' &&
      cancelled?.stopReason === 'cancelled' &&
      cancelled?.message === undefined,
    JSON.stringify(cancelled),
  );

  // ---- 3. failed ----------------------------------------------------------
  await ctl({ mode: 'error400' });
  await submit(page, 'A failed turn');
  list = await waitForSettlements(page, 3);
  const failed = list[2];
  record(
    'failed turn',
    failed?.outcome === 'failed' &&
      typeof failed?.error?.message === 'string' &&
      failed?.stopReason === undefined,
    JSON.stringify(failed),
  );

  // ---- 4. duplicate terminal ---------------------------------------------
  await ctl({ mode: 'complete', answer: 'Answer for the duplicate test.' });
  await px('dupTerminal');
  await submit(page, 'A duplicated terminal');
  list = await waitForSettlements(page, 4);
  await sleep(6000);
  const after = await settlements(page);
  const dupPrompt = after[3]?.promptId;
  const dupCount = after.filter((s) => s.promptId === dupPrompt).length;
  const pxState = await (await fetch(`${PROXY}/__px`)).json();
  record(
    'same terminal delivered twice -> one settlement',
    dupCount === 1 && pxState.counters.terminalsDuplicated >= 1,
    `promptId=${dupPrompt} settlements=${dupCount} proxy=${JSON.stringify(pxState.counters)}`,
  );

  // ---- 5. reconnect catch-up ---------------------------------------------
  await ctl({ mode: 'slow', answer: 'Answer that arrives while the stream is cut.' });
  await px('holdTerminal');
  await submit(page, 'A held terminal');
  list = await waitForSettlements(page, 5, 180_000);
  await sleep(4000);
  const afterHold = await settlements(page);
  const heldPrompt = afterHold[4]?.promptId;
  const heldCount = afterHold.filter((s) => s.promptId === heldPrompt).length;
  const pxAfterHold = await (await fetch(`${PROXY}/__px`)).json();
  record(
    'terminal held then replayed on reconnect -> exactly one settlement',
    heldCount === 1 &&
      afterHold[4]?.outcome === 'completed' &&
      pxAfterHold.counters.terminalsHeld >= 1,
    `${JSON.stringify(afterHold[4])} proxy=${JSON.stringify(pxAfterHold.counters)}`,
  );

  // ---- 6. persisted history stays silent ---------------------------------
  await page.close();
  page = await openHost(browser, `&session=${sessionOne}`);
  await page.waitForFunction(
    () => document.body.innerText.includes('A completed turn'),
    { timeout: 90_000 },
  );
  await sleep(8000);
  const silentSettlements = await settlements(page);
  const silentChanges = await sessionChanges(page);
  record(
    'persisted history load stays silent',
    silentSettlements.length === 0 && silentChanges.length === 0,
    `settled=${silentSettlements.length} sessionChange=${silentChanges.length}, transcript restored`,
  );
  await page.close();

  // ---- 7. split view ------------------------------------------------------
  await ctl({ mode: 'complete', answer: 'Split pane answer.' });
  page = await openHost(browser);
  await submit(page, 'Second session seed');
  const seeded = await waitForSettlements(page, 1);
  const sessionTwo = seeded[0]?.sessionId;
  await page.close();

  page = await openHost(browser, `&splitIds=${sessionOne},${sessionTwo}`);
  await page.waitForFunction(
    () => document.body.innerText.includes('2 panes'),
    { timeout: 90_000 },
  );
  await sleep(5000);
  const splitBefore = await settlements(page);
  const composers = page.locator('.cm-content');
  await composers.nth(0).click();
  await composers.nth(0).pressSequentially('Pane one turn', { delay: 8 });
  await page.keyboard.press('Enter');
  await sleep(2000);
  await composers.nth(1).click();
  await composers.nth(1).pressSequentially('Pane two turn', { delay: 8 });
  await page.keyboard.press('Enter');
  const splitList = await waitForSettlements(page, 2, 180_000);
  const sessions = new Set(splitList.map((s) => s.sessionId));
  record(
    'split view forwards one settlement per pane',
    splitBefore.length === 0 &&
      splitList.length === 2 &&
      sessions.has(sessionOne) &&
      sessions.has(sessionTwo),
    `silent-on-load=${splitBefore.length === 0} settlements=${JSON.stringify(
      splitList.map((s) => ({ s: s.sessionId?.slice(0, 8), p: s.promptId?.slice(0, 8), o: s.outcome })),
    )}`,
  );
  await page.screenshot({ path: '/var/tmp/pr11251r2/split-view.png', fullPage: false });
  await page.close();
} finally {
  await browser.close();
  log('\n=== summary ===');
  for (const r of results) log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  const failed = results.filter((r) => !r.pass).length;
  log(`${results.length - failed}/${results.length} passed`);
}
