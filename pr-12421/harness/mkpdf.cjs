const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
  const p = await b.newPage();
  await p.setContent(`<html><body style="font:20px sans-serif">
  <div style="page-break-after:always">PDF-PAGE-ONE alpha</div>
  <div>PDF-PAGE-TWO bravo</div></body></html>`);
  await p.pdf({ path: 'ws/report.pdf', format: 'A6' });
  await b.close();
})();
