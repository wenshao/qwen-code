// Render vitest ANSI transcripts side by side with real xterm.js.
//   node term.cjs <out.png> <title> <file1>::<caption1> <file2>::<caption2> ...
const fs = require('fs');
const { chromium } = require('/root/verify/pr13005/wt/node_modules/playwright-core');
const NM = '/root/verify/pr13005/wt/node_modules/@xterm/xterm';
const [, , out, title, ...panes] = process.argv;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COLS = 100;
const stripSgr = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function clean(raw) {
  // Drop VERBOSE poll chatter ("stdout | <test>\nPoll attempt N: ...\n\n") and
  // the yolo warning; keep everything vitest itself reports.
  const lines = raw.replace(/⎯/g, '─').replace(/\r/g, '').replace(/\x1b\[[0-9;]*[GKJ]/g, '').split('\n');
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    const plain = stripSgr(lines[i]);
    if (/^stdout \| /.test(plain) && /Poll attempt/.test(stripSgr(lines[i + 1] ?? ''))) { i += 2; continue; }
    if (/Poll attempt \d+/.test(plain)) continue;
    if (/^Warning: running headless with --yolo/.test(plain)) continue;
    if (/^(Keeping output|SDK E2E test output directory)/.test(plain)) continue;
    keep.push(lines[i]);
  }
  while (keep.length && !stripSgr(keep[keep.length - 1]).trim()) keep.pop();
  return keep.join('\n');
}

(async () => {
  const items = panes.map((p) => {
    const [file, caption] = p.split('::');
    const data = clean(fs.readFileSync(file, 'utf8'));
    const rows = data.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(stripSgr(l).length / COLS)), 0) + 3;
    return { data, caption, rows };
  });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1200 } });
  const css = fs.readFileSync(`${NM}/css/xterm.css`, 'utf8');
  const js = fs.readFileSync(`${NM}/lib/xterm.js`, 'utf8');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}
    body{margin:0;background:#fff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
    .wrap{padding:16px 18px;display:block;width:fit-content} h1{font-size:16px;margin:0 0 10px;color:#1f2328}
    .grid{display:flex;gap:14px;align-items:flex-start} .pane{background:#0d1117;border-radius:8px;padding:10px 12px}
    .cap{color:#e6edf3;font-size:13px;font-weight:600;margin:0 0 6px}
  </style></head><body><div class="wrap"><h1>${esc(title)}</h1><div class="grid">${items
    .map((it, i) => `<div class="pane"><div class="cap">${esc(it.caption)}</div><div id="t${i}"></div></div>`)
    .join('')}</div></div><script>${js}</script></body></html>`);
  await page.evaluate(async (items) => {
    await Promise.all(items.map((it, i) => new Promise((res) => {
      const term = new window.Terminal({ cols: 100, rows: it.rows, convertEol: true, scrollback: 0, fontSize: 12, fontFamily: 'DejaVu Sans Mono, monospace',
        theme: { background: '#0d1117', foreground: '#e6edf3', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', cyan: '#39c5cf', brightBlack: '#8b949e' } });
      term.open(document.getElementById('t' + i));
      term.write(it.data + '\x1b[?25l', res);
    })));
  }, items);
  await page.waitForTimeout(300);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  const box2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: out, clip: box2 });
  await browser.close();
  console.log('wrote', out, Math.round(box2.width), 'x', Math.round(box2.height));
})();
