const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const NM = '/root/git/qwen-code-x9/node_modules';
const xjs = fs.readFileSync(NM + '/@xterm/xterm/lib/xterm.js', 'utf8');
const xcss = fs.readFileSync(NM + '/@xterm/xterm/css/xterm.css', 'utf8');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const figs = JSON.parse(process.argv[2]);
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const f of figs) {
    const data = fs.readFileSync(f.file, 'utf8');
    const COLS = f.cols || 165;
    const plain = data.replace(/\x1b\[[0-9;]*m/g, '');
    let rows = 3;
    for (const line of plain.split('\n')) rows += Math.max(1, Math.ceil(line.length / COLS));
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1800, height: 900 } });
    await page.setContent(`<html><head><style>${xcss}
      body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
      .wrap{padding:18px 22px 22px;background:#0d1117;display:block;width:fit-content}
      .title{color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 4px}
      .cap{color:#8b949e;font-size:12.5px;margin:0 0 12px}
      #t{display:block}</style></head><body><div class="wrap"><div class="title">${esc(f.title)}</div><div class="cap">${esc(f.cap)}</div><div id="t"></div></div>
      <script>${xjs}</script></body></html>`);
    await page.evaluate(({ data, COLS, rows }) => new Promise(res => {
      const term = new Terminal({ cols: COLS, rows, convertEol: true, scrollback: 0, fontSize: 12.5,
        fontFamily: 'DejaVu Sans Mono, Menlo, Consolas, monospace', cursorBlink: false,
        theme: { background: '#0d1117', foreground: '#d0d7de', cursor: '#0d1117', cyan: '#39c5cf', brightCyan: '#56d4dd',
          green: '#3fb950', brightGreen: '#56d364', yellow: '#d29922', brightYellow: '#e3b341', red: '#ff7b72', brightRed: '#ffa198' } });
      term.open(document.getElementById('t'));
      term.write('\x1b[?25l' + data, () => setTimeout(res, 150));
    }), { data, COLS, rows });
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    box = await page.locator('.wrap').boundingBox();
    await page.locator('.wrap').screenshot({ path: f.out });
    console.log(f.out, Math.round(box.width), 'x', Math.round(box.height), 'rows', rows);
    await page.close();
  }
  await browser.close();
})();
