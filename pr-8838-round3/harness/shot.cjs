// Opens a cold session in the real Web Shell served by the daemon and
// screenshots the restored transcript.
//   NODE_PATH=<wt>/node_modules node shot.cjs <baseUrl> <token> <sessionId> <out.png> <waitText>
const { chromium } = require('playwright');

(async () => {
  const [base, token, sessionId, out, waitText] = process.argv.slice(2);
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/capabilities`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status !== 503) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', (r) => {
    if (/\/session\//.test(r.url())) reqs.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(`${base}/session/${sessionId}?token=${token}&language=en`);
  await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out, fullPage: false });
  const text = await page.evaluate(() => document.body.innerText);
  require('fs').writeFileSync(out.replace(/\.png$/, '.txt'), text + '\n\n---requests---\n' + reqs.join('\n'));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
