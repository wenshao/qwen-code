// Rig driver for PR #13097 real-stack verification on Linux.
// Real daemon (`qwen serve --web`) + real session + real command submission
// through the browser composer. ONLY the read-only GET context-usage HTTP
// response is mocked (browser-level route interception), per the PR's own
// evidence methodology.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { buildCatalog } from './catalog.mjs';

const BASE = process.env.RIG_BASE ?? 'http://127.0.0.1:13097';
const OUT = process.env.RIG_OUT ?? '/root/rig13097/shots';
const MODE = process.env.RIG_MODE ?? 'after'; // 'before' | 'after'
const SESSION_ID = process.env.RIG_SESSION_ID;

fs.mkdirSync(OUT, { recursive: true });

const { status, tools } = buildCatalog({ sessionId: SESSION_ID ?? 'rig13097-session' });
const jsonCodeUnits = JSON.stringify(status).length;
// Plain /context (detail=false) gets a compact summary status; only the
// detailed requests carry the >100k catalog.
const summaryStatus = {
  ...status,
  usage: {
    ...status.usage,
    builtinTools: [],
    mcpTools: [],
    memoryFiles: [],
    skills: [],
    showDetails: false,
  },
  formattedText: 'Context usage summary (mocked, compact)',
};
console.log(`catalog entries=${tools.length} jsonCodeUnits=${jsonCodeUnits}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    ...(process.env.RIG_CHROME
      ? { executablePath: process.env.RIG_CHROME }
      : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const installMock = async (page) => {
    await page.route('**/session/*/context-usage*', (route) => {
      const url = route.request().url();
      const detailed = /[?&]detail=true/.test(url);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailed ? status : summaryStatus),
      });
    });
  };

  const newPage = async (width, height) => {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 300)}`);
    });
    await installMock(page);
    return page;
  };

  const openSession = async (page) => {
    await page.goto(`${BASE}/session/${encodeURIComponent(SESSION_ID)}`);
    await page.waitForSelector('[data-web-shell-composer-editor] .cm-content', {
      timeout: 30000,
    });
    // wait out loading state
    await page
      .getByText('Loading...')
      .waitFor({ state: 'detached', timeout: 30000 })
      .catch(() => {});
    await sleep(500);
  };

  const submitCommand = async (page, text) => {
    const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
    await editor.click();
    await editor.fill(text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  };

  const cardOf = (page) =>
    page.getByRole('group', { name: 'Context Usage', exact: true });

  const messagesOf = (page) => page.locator('[data-web-shell-message-list]');

  const report = { mode: MODE, jsonCodeUnits, entries: tools.length, checks: [] };
  const check = (name, ok, extra = '') => {
    report.checks.push({ name, ok, extra });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  };

  // ---------- Scenario 1: /context detail at desktop 1200x878 ----------
  {
    const page = await newPage(1200, 878);
    await openSession(page);
    await submitCommand(page, '/context detail');
    const card = cardOf(page);
    const cardOk = await card
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    await sleep(800);
    const msgs = messagesOf(page);
    const bodyText = await msgs.innerText();
    check('s1.card-visible', cardOk);
    check('s1.no-sentinel-prefix', !bodyText.includes('web-shell:context-usage:v1:'));
    check('s1.no-truncated-marker', !bodyText.includes('[truncated]'));
    const repCount = (bodyText.match(/�/g) ?? []).length;
    check(
      's1.replacement-char-only-header-icon',
      repCount <= 1,
      `count=${repCount} (1 = card header icon glyph)`,
    );
    if (!cardOk) {
      // Broken render (pre-fix): preserve exactly what the user sees.
      console.log(
        `s1 broken-render excerpt: ${JSON.stringify(bodyText.slice(0, 400))}`,
      );
      await page.screenshot({ path: `${OUT}/${MODE}-context-detail-1200.png`, fullPage: false });
      const msgs2 = page.locator('[data-web-shell-message-list]');
      await msgs2.evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => {});
      await sleep(300);
      await page.screenshot({ path: `${OUT}/${MODE}-context-detail-1200-tail.png` });
      await page.context().close();
    } else {
    const firstCount = await card.getByText(tools[0].name, { exact: true }).count();
    const lastCount = await card.getByText(tools[tools.length - 1].name, { exact: true }).count();
    check('s1.first-entry-present', firstCount === 1, `count=${firstCount}`);
    check('s1.last-entry-present', lastCount === 1, `count=${lastCount}`);
    await page.screenshot({ path: `${OUT}/${MODE}-context-detail-1200.png` });
    await card.getByText(tools[tools.length - 1].name, { exact: true }).scrollIntoViewIfNeeded();
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${MODE}-context-detail-1200-tail.png` });
    check(
      's1.last-entry-visible-after-scroll',
      await card.getByText(tools[tools.length - 1].name, { exact: true }).isVisible(),
    );
    await page.context().close();
    }
  }

  // ---------- Scenario 2: /context -d at 390x844 (narrow) ----------
  {
    const page = await newPage(390, 844);
    await openSession(page);
    await submitCommand(page, '/context -d');
    const card = cardOf(page);
    const cardOk = await card
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    await sleep(800);
    const bodyText = await messagesOf(page).innerText();
    check('s2.card-visible-390', cardOk);
    check('s2.no-sentinel-prefix', !bodyText.includes('web-shell:context-usage:v1:'));
    check('s2.no-truncated-marker', !bodyText.includes('[truncated]'));
    if (!cardOk) {
      await page.screenshot({ path: `${OUT}/${MODE}-context-detail-390.png` });
      await page.context().close();
    } else {
    await card.getByText(tools[tools.length - 1].name, { exact: true }).scrollIntoViewIfNeeded();
    await sleep(400);
    check(
      's2.last-entry-visible-390',
      await card.getByText(tools[tools.length - 1].name, { exact: true }).isVisible(),
    );
    await page.screenshot({ path: `${OUT}/${MODE}-context-detail-390-tail.png` });
    await page.context().close();
    }
  }

  // ---------- Scenario 3: plain /context summary + in-card View Details (390px) ----------
  {
    const page = await newPage(390, 844);
    await openSession(page);
    await submitCommand(page, '/context');
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/${MODE}-context-summary-390.png` });
    const bodyText = await messagesOf(page).innerText();
    check('s3.summary-rendered', !bodyText.includes('web-shell:context-usage:v1:'));
    // Click "View Details" inside the summary card
    const viewDetails = page.getByRole('button', { name: /view details|查看明细|查看详情/i });
    const vdCount = await viewDetails.count();
    check('s3.view-details-button-present', vdCount > 0, `count=${vdCount}`);
    if (vdCount > 0) {
      await viewDetails.first().click();
      const detailCard = cardOf(page).last();
      await sleep(1200);
      const txt = await messagesOf(page).innerText();
      const detailVisible = await detailCard.isVisible().catch(() => false);
      check('s3.detail-card-after-view-details', detailVisible);
      check('s3.no-sentinel-after-view-details', !txt.includes('web-shell:context-usage:v1:'));
      const lastCount = await detailCard.getByText(tools[tools.length - 1].name, { exact: true }).count();
      check('s3.last-entry-after-view-details', lastCount === 1, `count=${lastCount}`);
      await page.screenshot({ path: `${OUT}/${MODE}-context-view-details-390.png` });
    }
    await page.context().close();
  }

  // ---------- Scenario 4: read-only command during an active stream ----------
  if ((process.env.RIG_SCENARIOS ?? '1,2,3,4').includes('4')) {
    const page = await newPage(1200, 878);
    await openSession(page);
    // Kick off a slow-streaming assistant turn against the mock model.
    await submitCommand(page, 'please stream a long reply');
    // Wait for the first streamed chunk to render.
    await page
      .getByText(/chunk-1 /)
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
    const streamLocator = page
      .locator('[data-web-shell-message-list]')
      .getByText(/chunk-\d+/)
      .last();
    const textAt = async () =>
      (await streamLocator.innerText().catch(() => '')).length;
    const echoesBefore = await page.getByText('/context detail', { exact: true }).count();
    const lenBefore = await textAt();
    // Fire the read-only command mid-stream: it must run immediately.
    await submitCommand(page, '/context detail');
    const card = cardOf(page).last();
    await card.waitFor({ state: 'visible', timeout: 20000 });
    check('s4.card-appears-mid-stream', true);
    await page.screenshot({ path: `${OUT}/${MODE}-streaming-context-detail-1200.png` });
    // The command echo must be suppressed for read-only requests mid-stream.
    await sleep(300);
    const echoesAfter = await page.getByText('/context detail', { exact: true }).count();
    check(
      's4.command-echo-suppressed',
      echoesAfter === echoesBefore,
      `before=${echoesBefore} after=${echoesAfter}`,
    );
    // The stream must keep advancing after the read-only request.
    await sleep(4000);
    const lenAfter = await textAt();
    check('s4.stream-continues', lenAfter > lenBefore, `${lenBefore} -> ${lenAfter}`);
    // Wait for stream completion (60 chunks @ 500ms).
    await page
      .getByText(/chunk-59/)
      .first()
      .waitFor({ state: 'visible', timeout: 60000 })
      .catch(() => {});
    const finalText = await messagesOf(page).innerText();
    check('s4.stream-completed', finalText.includes('chunk-59'));
    check('s4.no-sentinel', !finalText.includes('web-shell:context-usage:v1:'));
    check('s4.no-truncated-marker', !finalText.includes('[truncated]'));
    await page.screenshot({ path: `${OUT}/${MODE}-streaming-complete-1200.png` });
    await page.context().close();
  }

  fs.writeFileSync(`${OUT}/${MODE}-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  const failed = report.checks.filter((c) => !c.ok);
  console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
