// PR #12234 — real-daemon browser E2E. No page.route, no mock daemon:
// Chromium -> daemon-served production Web Shell -> real `qwen serve` -> real
// chats/<id>.jsonl seeded by 600 real turns. Ground truth comes from the JSONL.
const { chromium } = require('playwright');
const fs = require('node:fs');
const truth = require('./truth.json');
const LONG = require('./seed-long.json').sessionId;
const SHORT = require('./seed-short5.json').sessionId;
const BASE = process.env.BASE ?? 'http://127.0.0.1:14234';
const TOKEN = 'verify-token-12234';
const SHOTS = __dirname + '/shots';
const only = process.env.ONLY?.split(',');

const results = [];
function check(id, name, pass, detail) {
  results.push({ id, name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
}
const searchButton = (page) => page.getByRole('button', { name: /^(Search this conversation|搜索当前会话)$/ });
const dialogOf = (page) => page.locator('[data-conversation-search]');

async function openSession(browser, sessionId, { width = 1440, height = 900, theme, lang } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme === 'light' ? 'light' : 'dark',
    locale: lang === 'zh-CN' ? 'zh-CN' : 'en-US',
  });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/\/(turn-index|transcript)$/.test(u.pathname))
      wire.push({ t: Date.now(), kind: u.pathname.split('/').pop(), q: Object.fromEntries(u.searchParams) });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(`${BASE}/session/${sessionId}?token=${TOKEN}`);
  await page.locator('[data-web-shell-composer-editor] .cm-content').waitFor({ timeout: 30000 });
  return { ctx, page, wire, errors };
}

// Type a query and wait until the dialog stops scanning. Returns timing + wire cost.
async function runQuery(page, wire, query) {
  const dialog = dialogOf(page);
  const input = dialog.locator('input');
  const before = wire.length;
  const t0 = Date.now();
  await input.fill(query);
  const status = dialog.locator('[role=status]');
  // debounce is 250ms; wait for the searching label to appear then clear.
  await page.waitForTimeout(350);
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-conversation-search] [role=status]');
      return el && !/Searching|正在搜索|搜索中/.test(el.textContent ?? '');
    },
    undefined,
    { timeout: 120000 },
  );
  const ms = Date.now() - t0;
  const reqs = wire.slice(before);
  return {
    ms,
    transcriptReqs: reqs.filter((r) => r.kind === 'transcript').length,
    indexReqs: reqs.filter((r) => r.kind === 'turn-index').length,
    status: (await status.textContent())?.trim(),
    options: await dialog.getByRole('option').count(),
  };
}

(async () => {
  const browser = await chromium.launch();

  // ---------- S1..S10: long session (600 real turns, cold-loaded after daemon restart)
  if (!only || only.includes('long')) {
    const { page, wire, errors } = await openSession(browser, LONG);
    await page.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 30000 });
    const firstLive = await page.evaluate(() => {
      const m = /Question #(\d+)/.exec(document.querySelector('[data-web-shell-message-list]')?.textContent ?? '');
      return m ? Number(m[1]) : null;
    });
    await page.locator('[data-global-turn-navigation]').waitFor({ timeout: 10000 }).catch(() => {});
    check('S1a', 'cold-loaded long session shows the timeline rail', (await page.locator('[data-global-turn-navigation]').count()) === 1);
    check('S1b', 'search entry present (1200 persisted messages > 10)', (await searchButton(page).count()) === 1, { firstLiveQuestion: firstLive });
    check('S1c', 'needle turns are OUTSIDE the initially rendered window', firstLive !== null && firstLive > 200, { firstLiveQuestion: firstLive });
    await page.screenshot({ path: `${SHOTS}/r2-01-entry-real-daemon.png` });

    const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
    await editor.click();
    await page.keyboard.type('Unsent draft survives search');

    await searchButton(page).click();
    const dialog = dialogOf(page);
    await dialog.locator('input').waitFor();
    check('S2a', 'dialog opens with the input focused', await dialog.locator('input').evaluate((el) => document.activeElement === el));

    // S2: case-insensitive deep-history hit
    let q = await runQuery(page, wire, 'zebra-quartz-7731');
    const markText = await dialog.locator('[role=option] mark').first().textContent();
    check('S2b', 'lower-case query finds the single upper-case hit in turn #3', q.options === truth.expected['ZEBRA-QUARTZ-7731'] && markText === 'ZEBRA-QUARTZ-7731', { ...q, markText });
    const fullScan = q;
    await page.screenshot({ path: `${SHOTS}/r2-02-deep-history-hit.png` });

    // S5: literal code / regex metacharacters
    q = await runQuery(page, wire, 'code-needle-0xC0FFEE');
    check('S5a', 'code-block token found (1 hit)', q.options === 1, q);
    q = await runQuery(page, wire, 'a+|b(c)*[d]?\\.$^{2}');
    const litMark = await dialog.locator('[role=option] mark').first().textContent().catch(() => null);
    check('S5b', 'regex-looking query matched literally (1 hit, exact mark)', q.options === 1 && litMark === 'a+|b(c)*[d]?\\.$^{2}', { ...q, litMark });
    await page.screenshot({ path: `${SHOTS}/r2-03-literal-metachar.png` });
    q = await runQuery(page, wire, '.*');
    check('S5c', '`.*` is literal: 0 hits and the empty state is shown', q.options === 0 && /No (matching|results)|未找到|没有/.test(q.status ?? ''), q);
    await page.screenshot({ path: `${SHOTS}/r2-04-empty-state.png` });

    // S4: Chinese
    q = await runQuery(page, wire, '薛定谔的猫态');
    check('S4a', 'Chinese phrase found (1 hit)', q.options === 1, q);
    q = await runQuery(page, wire, '量子纠缠');
    const roles = await dialog.locator('[role=option] > span').allTextContents();
    check('S4b', 'Chinese phrase in user + assistant message (2 hits, both roles)', q.options === 2 && new Set(roles).size === 2, { ...q, roles });
    await page.screenshot({ path: `${SHOTS}/r2-05-chinese-two-roles.png` });

    // S8: user-only needle
    q = await runQuery(page, wire, 'USER-ONLY-NEEDLE-plum');
    check('S8', 'user-message-only needle found with the user role label', q.options === 1 && /You|User|用户|你/.test((await dialog.locator('[role=option] > span').first().textContent()) ?? ''), q);

    // S7: more matches than the cap
    q = await runQuery(page, wire, 'common-token');
    const limited = await dialog.getByText(/200/).count();
    const texts = await dialog.getByRole('option').allTextContents();
    const nums = texts.map((t) => Number(/Answer #(\d+)/.exec(t)?.[1]));
    check('S7a', '600 matching messages render exactly 200 rows + a limit notice', q.options === 200 && limited > 0, { ...q, truthMatches: truth.expected['common-token'] });
    check('S7b', 'observation: the 200 retained rows are the OLDEST matches', Math.min(...nums) === 1 && Math.max(...nums) === 200, { min: Math.min(...nums), max: Math.max(...nums) });
    await page.screenshot({ path: `${SHOTS}/r2-06-cap-200.png` });

    // S6: duplicate text, identity-based navigation via keyboard
    q = await runQuery(page, wire, 'DUPLICATE-PAYLOAD-ALPHA');
    check('S6a', 'identical text in two turns yields two distinct hits', q.options === 2, q);
    await page.keyboard.press('ArrowDown');
    const selected = await dialog.locator('[role=option][aria-selected=true]').textContent();
    check('S6b', 'ArrowDown selects the second (turn #200) hit', /Answer #200/.test(selected ?? ''), { selected: selected?.slice(0, 60) });
    const beforeNav = wire.length;
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached', timeout: 60000 });
    const historical = page.locator('[data-history-viewport="historical"]');
    await historical.getByText('Answer #200:', { exact: false }).first().waitFor({ timeout: 30000 });
    const flash = historical.locator('[class*="flash"]');
    await flash.first().waitFor({ timeout: 10000 });
    const flashText = await flash.first().textContent();
    const anchors = wire.slice(beforeNav).filter((r) => r.q.atRecordId).map((r) => r.q.atRecordId);
    check('S6c', 'Enter lands on turn #200 (not the identical text in turn #10) with a flash highlight', /Answer #200/.test(flashText ?? '') && !/Answer #10:/.test(flashText ?? ''), { flashText: flashText?.slice(0, 70) });
    check('S6d', 'daemon was asked for the turn-#200 anchor', anchors.includes(truth.turns['200'].user), { anchors, expected: truth.turns['200'].user });
    check('S3a', 'unsent composer draft is preserved across search + navigation', (await editor.textContent()) === 'Unsent draft survives search');
    await page.screenshot({ path: `${SHOTS}/r2-07-located-turn-200.png` });

    // now the other duplicate
    await searchButton(page).click();
    await dialog.locator('input').waitFor();
    q = await runQuery(page, wire, 'DUPLICATE-PAYLOAD-ALPHA');
    await dialog.getByRole('option').first().click();
    await dialog.waitFor({ state: 'detached', timeout: 60000 });
    await historical.locator('[class*="flash"]').filter({ hasText: 'Answer #10:' }).first().waitFor({ timeout: 30000 });
    check('S6e', 'choosing the first hit lands on turn #10', true);

    // S3: deepest target (turn #3) from a historical position
    await searchButton(page).click();
    await dialog.locator('input').waitFor();
    q = await runQuery(page, wire, 'zebra-quartz-7731');
    const navStart = wire.length;
    const tNav = Date.now();
    await dialog.getByRole('option').first().click();
    await dialog.waitFor({ state: 'detached', timeout: 60000 });
    await historical.locator('[class*="flash"]').filter({ hasText: 'ZEBRA-QUARTZ-7731' }).first().waitFor({ timeout: 30000 });
    check('S3b', 'navigates to the turn-#3 assistant message and flashes it', true, {
      ms: Date.now() - tNav,
      navRequests: wire.length - navStart,
    });
    await page.screenshot({ path: `${SHOTS}/r2-08-located-turn-3.png` });

    // S9: live-window hit
    await searchButton(page).click();
    await dialog.locator('input').waitFor();
    q = await runQuery(page, wire, 'topic-600');
    check('S9a', 'hit inside the live window is found exactly once (no live/persisted duplicate)', q.options === 1, q);
    await dialog.getByRole('option').first().click();
    await dialog.waitFor({ state: 'detached', timeout: 60000 });
    await page.locator('[class*="flash"]').filter({ hasText: 'topic-600' }).first().waitFor({ timeout: 30000 });
    check('S9b', 'navigates back to the live tail message', true);

    // S10: Escape + focus restore
    await searchButton(page).click();
    await dialog.locator('input').waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(150);
    check('S10', 'Escape closes the dialog and focus returns to the trigger', await searchButton(page).evaluate((el) => document.activeElement === el));

    check('W1', 'wire cost of ONE full-history query (600 turns / 1200 messages / 2.8 MB JSONL)', true, fullScan);
    check('E1', 'no uncaught page errors during the long-session run', errors.length === 0, errors);
    fs.writeFileSync(__dirname + '/wire-long.json', JSON.stringify(wire, null, 1));
    await page.context().close();
  }

  // ---------- S11: threshold with REAL live admission (10 -> 11 messages)
  if (!only || only.includes('short')) {
    const { page, errors } = await openSession(browser, SHORT);
    await page.getByText('Answer #5:', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500); // let the threshold probe finish
    check('S11a', '10 persisted messages: search entry absent', (await searchButton(page).count()) === 0);
    await page.screenshot({ path: `${SHOTS}/r2-09-threshold-10-absent.png` });
    const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
    await editor.click();
    await page.keyboard.type('Question #6: tell me about topic-6');
    await page.locator('[data-web-shell-composer-submit]').click();
    await page.getByText('Answer #6:', { exact: false }).first().waitFor({ timeout: 30000 });
    await searchButton(page).waitFor({ timeout: 15000 }).catch(() => {});
    check('S11b', 'after a REAL 6th turn (12 messages) the entry appears without reload', (await searchButton(page).count()) === 1);
    await page.screenshot({ path: `${SHOTS}/r2-10-threshold-12-present.png` });
    check('E2', 'no uncaught page errors during the short-session run', errors.length === 0, errors);
    await page.context().close();
  }

  // ---------- S16: light theme + zh-CN + narrow
  if (!only || only.includes('matrix')) {
    const { page } = await openSession(browser, LONG, { width: 390, height: 844 });
    await page.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    check('S16', '390px layout: entry hidden together with the timeline (as declared)', !(await searchButton(page).isVisible().catch(() => false)));
    await page.screenshot({ path: `${SHOTS}/r2-11-narrow-390.png` });
    await page.context().close();
  }

  await browser.close();
  const tag = only ? '-' + only.join('_') : '';
  fs.writeFileSync(`${__dirname}/results-real${tag}.json`, JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  fs.writeFileSync(`${__dirname}/results-real-partial.json`, JSON.stringify(results, null, 1));
  process.exit(2);
});
