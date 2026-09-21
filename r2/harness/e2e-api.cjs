// PR #12234 — public `navigateToMessage` + `conversationSearchThreshold` against a
// REAL daemon, through a verification-only embedding host (vite dev -> daemon).
// Record IDs are the real persisted uuids read from chats/<id>.jsonl.
const { chromium } = require('playwright');
const fs = require('node:fs');
const truth = require('./truth.json');
const LONG = require('./seed-long.json').sessionId;
const SHORT = require('./seed-short.json').sessionId;
const BASE = process.env.BASE ?? 'http://127.0.0.1:15234';
const TOKEN = 'verify-token-12234';
const SHOTS = __dirname + '/shots';
const results = [];
function check(id, name, pass, detail) {
  results.push({ id, name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
}
const searchButton = (page) => page.getByRole('button', { name: /^(Search this conversation|搜索当前会话)$/ });

async function openHarness(browser, sessionId, query = '', viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/\/(turn-index|transcript)$/.test(u.pathname)) wire.push({ kind: u.pathname.split('/').pop(), q: Object.fromEntries(u.searchParams) });
  });
  await page.goto(`${BASE}/e2e/verify-real-harness.html?sessionId=${sessionId}&token=${TOKEN}${query}`);
  await page.locator('[data-web-shell-composer-editor] .cm-content').waitFor({ timeout: 60000 });
  return { page, wire };
}
const nav = (page, request, abortAfterMs) =>
  page.evaluate(([r, a]) => window.navigateReal(r, a), [request, abortAfterMs]);

(async () => {
  const browser = await chromium.launch();

  // ---- A: public API, timeline hidden (wide chat), long session
  {
    const { page, wire } = await openHarness(browser, LONG, '&theme=light');
    await page.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    check('A0', 'embedding host exposes navigateToMessage on shellRef', await page.evaluate(() => window.hasNavigateToMessage()));
    check('A1', 'timeline + search entry hidden in this embedding (API must not depend on them)',
      (await page.locator('[data-global-turn-navigation]').count()) === 0 && (await searchButton(page).count()) === 0);
    const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
    await editor.click();
    await page.keyboard.type('Host draft stays put');

    const historical = page.locator('[data-history-viewport="historical"]');
    // deep assistant record (turn #3)
    let before = wire.length;
    let t0 = Date.now();
    let r = await nav(page, { sessionId: LONG, recordId: truth.turns['3'].assistant });
    let ms = Date.now() - t0;
    await historical.locator('[class*="flash"]').filter({ hasText: 'ZEBRA-QUARTZ-7731' }).first().waitFor({ timeout: 30000 });
    check('A2', 'assistant record from turn #3 -> located, historical viewport flashes that exact message', r.status === 'located',
      { result: r, ms, requests: wire.length - before });
    await page.screenshot({ path: `${SHOTS}/r2-12-api-located-turn-3.png` });

    // identity, not text: two records with identical text
    r = await nav(page, { sessionId: LONG, recordId: truth.turns['200'].assistant });
    await historical.locator('[class*="flash"]').filter({ hasText: 'Answer #200:' }).first().waitFor({ timeout: 30000 });
    const r10 = await nav(page, { sessionId: LONG, recordId: truth.turns['10'].assistant });
    await historical.locator('[class*="flash"]').filter({ hasText: 'Answer #10:' }).first().waitFor({ timeout: 30000 });
    check('A3', 'identical-text records resolve by identity (#200 then #10)', r.status === 'located' && r10.status === 'located');

    // user record
    r = await nav(page, { sessionId: LONG, recordId: truth.turns['42'].user });
    await page.locator('[class*="flash"]').filter({ hasText: 'user-only-needle-PLUM' }).first().waitFor({ timeout: 30000 });
    check('A4', 'user record from turn #42 -> located', r.status === 'located', r);

    // late record near the live tail, from a historical position
    before = wire.length;
    t0 = Date.now();
    r = await nav(page, { sessionId: LONG, recordId: truth.turns['599'].assistant });
    ms = Date.now() - t0;
    await page.locator('[class*="flash"]').filter({ hasText: 'Answer #599:' }).first().waitFor({ timeout: 30000 });
    check('A5', 'record in the live tail (turn #599) -> located', r.status === 'located', { result: r, ms, requests: wire.length - before });

    // negative statuses
    const shownBefore = await page.locator('[data-web-shell-message-list]').textContent();
    before = wire.length;
    t0 = Date.now();
    r = await nav(page, { sessionId: LONG, recordId: '00000000-0000-4000-8000-000000000000' });
    check('A6', 'unknown record -> not_found after a full scan; view unchanged', r.status === 'not_found' &&
      (await page.locator('[data-web-shell-message-list]').textContent()) === shownBefore, { result: r, ms: Date.now() - t0, requests: wire.length - before });
    r = await nav(page, { sessionId: SHORT, recordId: truth.turns['3'].assistant });
    check('A7', 'other session id -> session_mismatch', r.status === 'session_mismatch', r);
    r = await nav(page, { sessionId: LONG, recordId: '   ' });
    check('A8', 'blank record id -> not_found', r.status === 'not_found', r);
    r = await nav(page, { sessionId: LONG, recordId: truth.turns['3'].assistant }, 0);
    check('A9', 'already-aborted signal -> cancelled', r.status === 'cancelled', r);
    // a system record id (turn_result) is a real persisted uuid but not a user/assistant message
    const sysId = fs.readFileSync(__dirname + '/' + truth.file, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((x) => x && x.type === 'system' && x.subtype === 'turn_result').uuid;
    r = await nav(page, { sessionId: LONG, recordId: sysId });
    check('A10', 'non-message (system turn_result) record id -> not_found', r.status === 'not_found', { result: r, sysId });
    // superseding: fire two, first must be cancelled
    const pair = await page.evaluate(async ([s, a, b]) => {
      const p1 = window.navigateReal({ sessionId: s, recordId: a });
      const p2 = window.navigateReal({ sessionId: s, recordId: b });
      return Promise.all([p1, p2]);
    }, [LONG, truth.turns['3'].assistant, truth.turns['150'].assistant]);
    await page.locator('[class*="flash"]').filter({ hasText: 'Answer #150:' }).first().waitFor({ timeout: 30000 });
    check('A11', 'a newer valid request supersedes the older one (cancelled, located) and the newer target wins',
      pair[0].status === 'cancelled' && pair[1].status === 'located', pair);
    check('A12', 'host draft untouched after 9 API calls', (await editor.textContent()) === 'Host draft stays put');
    await page.screenshot({ path: `${SHOTS}/r2-13-api-superseded-turn-150.png` });
    await page.context().close();
  }

  // ---- B: conversationSearchThreshold host option, timeline visible
  {
    for (const [sid, label, threshold, expected] of [
      [SHORT, 'short(12 msgs)', 12, 0],
      [SHORT, 'short(12 msgs)', 11, 1],
      [LONG, 'long(1200 msgs)', 1199, 1],
      [LONG, 'long(1200 msgs)', 1200, 0],
      [SHORT, 'short(12 msgs)', 0, 1],
    ]) {
      const { page, wire } = await openHarness(browser, sid, `&timeline=true&threshold=${threshold}`);
      await page.getByText(sid === LONG ? 'Answer #600:' : 'Answer #6:', { exact: false }).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(sid === LONG ? 4000 : 2000);
      const n = await searchButton(page).count();
      check(`B-${label}-t${threshold}`, `threshold=${threshold} on ${label} -> entry ${expected ? 'present' : 'absent'}`, n === expected,
        { count: n, transcriptReqs: wire.filter((w) => w.kind === 'transcript').length });
      await page.context().close();
    }
  }
  await browser.close();
  fs.writeFileSync(`${__dirname}/results-api.json`, JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  fs.writeFileSync(`${__dirname}/results-api-partial.json`, JSON.stringify(results, null, 1));
  process.exit(2);
});
