// Render ANSI transcripts to PNG with the real xterm.js inside chromium.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const NM = '/root/git/qwen-code-x9/node_modules';
const xtermJs = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const xtermCss = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const figs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripSgr = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const fig of figs) {
    const cols = fig.cols || 132;
    const data = fig.data;
    const wrapped = stripSgr(data).split('\n')
      .reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0);
    const rows = wrapped + 2;
    const page = await browser.newPage({ viewportSize: { width: 2000, height: 1400 }, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${xtermCss}
      body{margin:0;background:#0d1117;font-family:ui-monospace,Menlo,monospace}
      .wrap{display:block;padding:18px 20px;background:#0d1117}
      .cap{color:#e6edf3;font:600 15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto;padding:0 0 12px 2px}
      .sub{color:#8b949e;font:400 12.5px/1.5 ui-sans-serif,system-ui;padding:0 0 12px 2px}
      #t{display:block}</style></head><body>
      <div class="wrap"><div class="cap">${esc(fig.title)}</div>${fig.subtitle ? `<div class="sub">${esc(fig.subtitle)}</div>` : ''}<div id="t"></div></div>
      <script>${xtermJs}</script><script>
        window.__done = false;
        const term = new Terminal({ cols: ${cols}, rows: ${rows}, convertEol: true, scrollback: 0,
          fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.25,
          theme: { background: '#0d1117', foreground: '#d0d7de', black:'#484f58', red:'#ff7b72',
                   green:'#3fb950', yellow:'#d29922', blue:'#58a6ff', magenta:'#bc8cff',
                   cyan:'#39c5cf', white:'#b1bac4', brightBlack:'#6e7681', brightRed:'#ffa198',
                   brightGreen:'#56d364', brightYellow:'#e3b341', brightBlue:'#79c0ff',
                   brightMagenta:'#d2a8ff', brightCyan:'#56d4dd', brightWhite:'#f0f6fc' } });
        term.open(document.getElementById('t'));
        term.write(${JSON.stringify(data)} + '\\x1b[?25l', () => { window.__done = true; });
      </script></body></html>`);
    await page.waitForFunction('window.__done === true', null, { timeout: 30000 });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const w = document.querySelector('.xterm-screen').getBoundingClientRect().width;
      const wrap = document.querySelector('.wrap');
      wrap.style.width = Math.ceil(w) + 'px';
      wrap.style.display = 'block';
      document.getElementById('t').style.width = Math.ceil(w) + 'px';
    });
    await page.waitForTimeout(150);
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    await page.waitForTimeout(150);
    box = await page.locator('.wrap').boundingBox();
    await page.locator('.wrap').screenshot({ path: path.join(OUT, fig.file) });
    console.log(fig.file, Math.round(box.width) + 'x' + Math.round(box.height), 'rows=' + rows);
    await page.close();
  }
  await browser.close();
})();
