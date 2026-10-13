// Renders the PR 13297 evidence cards (HTML -> PNG via the repo's Playwright).
// usage: node make.mjs <worktree-with-playwright>
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [worktree, cardsFile = 'cards.json'] = process.argv.slice(2);
const { chromium } = createRequire(path.join(worktree, 'package.json'))('playwright');
const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
mkdirSync(out, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{width:1500px;padding:28px 32px 26px;box-sizing:border-box;background:#0d1117}
h1{font-size:26px;margin:0 0 6px;font-weight:650}
.sub{color:#8b949e;font-size:15px;margin-bottom:18px;line-height:1.45}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th{font-size:14px;text-align:left;color:#8b949e;font-weight:600;padding:8px 10px;border-bottom:1px solid #30363d}
td{vertical-align:top;padding:10px;border-bottom:1px solid #21262d;font-size:14px;line-height:1.45}
td.s{color:#e6edf3;font-weight:600}
td.s .rig{display:block;color:#8b949e;font-weight:400;font-size:12.5px;margin-top:4px}
.bad{background:rgba(248,81,73,.10);border-left:3px solid #f85149}
.good{background:rgba(63,185,80,.10);border-left:3px solid #3fb950}
.neutral{background:rgba(139,148,158,.08);border-left:3px solid #6e7681}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
pre{white-space:pre-wrap;word-break:break-word;margin:0;color:#c9d1d9}
.note{margin-top:16px;border-left:4px solid #d29922;padding:8px 14px;color:#e6edf3;font-size:14px;line-height:1.5;background:rgba(210,153,34,.08)}
.k{color:#79c0ff}
`;

function card(file, title, sub, columns, rows, note) {
  const head = `<tr>${columns.map((c, i) => `<th style="width:${i === 0 ? 24 : 76 / (columns.length - 1)}%">${esc(c)}</th>`).join('')}</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr><td class="s">${esc(r[0])}${r[1] ? `<span class="rig">${esc(r[1])}</span>` : ''}</td>${r
          .slice(2)
          .map((c) => `<td class="${c.cls}"><pre>${esc(c.text)}</pre></td>`)
          .join('')}</tr>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div><table>${head}${body}</table>${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
  writeFileSync(path.join(out, `${file}.html`), html);
  return file;
}

const bad = (text) => ({ cls: 'bad', text });
const good = (text) => ({ cls: 'good', text });
const neutral = (text) => ({ cls: 'neutral', text });
const data = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(path.dirname(new URL(import.meta.url).pathname), cardsFile), 'utf8'));
const files = [];
for (const c of data) {
  files.push(
    card(
      c.file,
      c.title,
      c.sub,
      c.columns,
      c.rows.map((r) => [r[0], r[1], ...r.slice(2).map((cell) => ({ bad, good, neutral })[cell[0]](cell[1]))]),
      c.note,
    ),
  );
}
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
for (const f of files) {
  await page.goto(`file://${path.join(out, `${f}.html`)}`);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length,
  );
  await page.locator('#card').screenshot({ path: path.join(out, `${f}.png`) });
  console.log(`${f}.png clipped_pre=${clipped}`);
}
await browser.close();
