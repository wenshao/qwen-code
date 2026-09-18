/**
 * Round-2 probe: does a context-compression row reach hosts as the turn's
 * final assistant message?
 *
 * The R11-1 fix excludes two `meta.source` values. The compression row is
 * rendered as `role: 'system'` from payload keys (`contextCompressionNotice` /
 * `contextCompression`) while its block carries `meta.source: 'slash_command'`,
 * so a `meta.source` guard cannot see it. This drives a real `/compress`
 * against the real daemon and reports what the host callback received.
 */
import { chromium } from 'playwright';

const HOST = process.env.HOST_URL ?? 'http://127.0.0.1:5351';
const PROXY = process.env.PROXY_URL ?? 'http://127.0.0.1:4352';
const FAKE = process.env.FAKE_URL ?? 'http://127.0.0.1:5091';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

await fetch(`${FAKE}/__ctl`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'complete', answer: 'A first real answer.' }),
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.on('console', (m) => {
  if (m.text().startsWith('[PROBE')) log('   browser:', m.text());
});

async function type(text, enters = 1) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.pressSequentially(text, { delay: 8 });
  for (let i = 0; i < enters; i += 1) {
    await page.keyboard.press('Enter');
    await sleep(600);
  }
}

try {
  await page.goto(`${HOST}/?daemon=${PROXY}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__probe), { timeout: 60_000 });

  await type('Give me a first answer');
  await page.waitForFunction(
    () => (window.__probe.settlements ?? []).length >= 1,
    { timeout: 120_000 },
  );
  log('seed settlement:', JSON.stringify((await page.evaluate(() => window.__probe.settlements))[0]));

  const before = await page.evaluate(() => window.__probe.settlements.length);
  // A local slash command needs a second Enter: the first accepts the
  // completion popup.
  await type('/compress', 2);
  await sleep(25_000);

  const after = await page.evaluate(() => window.__probe.settlements);
  log(`settlements before=${before} after=${after.length}`);
  for (const s of after.slice(before)) log('  compress-turn settlement:', JSON.stringify(s));

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-message-role], [data-role]')]
      .slice(-8)
      .map((el) => ({
        role: el.getAttribute('data-message-role') ?? el.getAttribute('data-role'),
        text: (el.textContent ?? '').trim().slice(0, 90),
      })),
  );
  log('last rendered rows:', JSON.stringify(rows, null, 1));

  const blocks = await page.evaluate(() => {
    const store = window.__probe?.transcript?.();
    return store ? store.slice(-6) : null;
  });
  log('transcript tail (if exposed):', JSON.stringify(blocks));
  await page.screenshot({ path: '/var/tmp/pr11251r2/compress.png' });
} finally {
  await browser.close();
}
