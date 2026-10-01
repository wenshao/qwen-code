// Cold session: if the Web Shell offers "Continue execution", click it (real
// UI path), wait for the continued answer and screenshot the result.
//   node cont.cjs <baseUrl> <token> <sessionId> <out.png>
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const [base, token, sessionId, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/session\//.test(r.url()))
      wire.push(`${r.method()} ${new URL(r.url()).pathname} ${r.postData() ?? ''}`.slice(0, 400));
  });
  await page.goto(`${base}/session/${sessionId}?token=${token}&language=en`);
  await page.getByText('Scheduled. It will run', { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const banner = page.getByTestId('session-recovery-banner');
  const result = { bannerVisible: await banner.isVisible() };
  if (result.bannerVisible) {
    result.bannerText = await banner.innerText();
    await banner.getByRole('button', { name: 'Continue execution' }).click();
    await page.getByText('FAILING-TASK-RESULT', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    result.bannerAfter = await banner.isVisible();
    await page.screenshot({ path: out });
  }
  result.wire = wire;
  fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(result, null, 2));
  console.log('CONTINUE', JSON.stringify(result).slice(0, 600));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
