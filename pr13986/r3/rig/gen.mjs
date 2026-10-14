// Evidence cards for PR 13986: data transcribed from the rig's [RESULT] lines
// (out/<scenario>/observations.log). Rendered with the worktree's Playwright.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/Users/wenshao/pr13986-rig/src-pr/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/pr13986-rig/fig3';

const css = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--acc:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{width:1320px;padding:28px 32px 26px;background:var(--bg)}
h1{font-size:23px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 8px;color:var(--acc)}
.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{background:var(--panel);color:var(--mut);font-weight:600}
td.mono,span.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}.warn{color:var(--warn);font-weight:600}.mut{color:var(--mut)}
.note{border-left:3px solid var(--acc);padding:8px 12px;margin-top:14px;background:var(--panel);font-size:13.5px}
.note.warn{border-color:var(--warn)}.note.bad{border-color:var(--bad)}
pre{background:var(--panel);border:1px solid var(--line);padding:10px 12px;font:12.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre;overflow:hidden;margin:6px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
`;

const cards = JSON.parse(fs.readFileSync(path.join(OUT, 'cards.json'), 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1320, height: 900 } });
for (const card of cards) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card">${card.html}</div></body></html>`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 60)));
  if (clipped.length) console.log(`WARN ${card.file}: clipped`, clipped);
  await page.locator('#card').screenshot({ path: path.join(OUT, card.file) });
  console.log('wrote', card.file);
}
await browser.close();
