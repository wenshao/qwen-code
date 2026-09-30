const { chromium } = require('playwright');
(async () => {
  const [base, token, sid, out] = process.argv.slice(2);
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`${base}/capabilities`, { headers: { Authorization: `Bearer ${token}` } }); if (r.status !== 503) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(`${base}/session/${sid}?token=${token}&language=en`);
  await p.getByText('NIGHTLY-REPORT-RESULT').first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.getByText(/Processed 21s|Processed 2\ds/).first().click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out });
  const t = await p.evaluate(() => document.querySelector('main')?.innerText ?? document.body.innerText);
  console.log(t.split('\n').filter(Boolean).slice(0, 40).join('\n'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
