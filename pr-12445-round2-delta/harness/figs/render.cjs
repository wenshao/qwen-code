// Render ANSI transcripts to PNG with the real xterm.js (fresh page per figure, viewport sized to content).
const fs = require('fs');
const path = require('path');
const NM = process.env.NM; // a node_modules dir with playwright-core and @xterm/xterm
const { chromium } = require(NM + '/playwright-core');
const xtermJs = fs.readFileSync(NM + '/@xterm/xterm/lib/xterm.js', 'utf8');
const xtermCss = fs.readFileSync(NM + '/@xterm/xterm/css/xterm.css', 'utf8');
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const theme = { background: '#0d1117', foreground: '#d0d7de', cyan: '#58c4dc', green: '#3fb950',
  red: '#ff7b72', yellow: '#d29922', magenta: '#d2a8ff', brightMagenta: '#e2c2ff', white: '#e6edf3' };
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
(async () => {
  const browser = await chromium.launch({ executablePath: exe });
  for (const name of process.argv.slice(2)) {
    const data = fs.readFileSync(path.join(__dirname, name + '.ansi'), 'utf8').replace(/\n+$/, '');
    const lines = data.split('\n');
    const cols = Math.max(...lines.map((l) => strip(l).length)) + 2;
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(strip(l).length / cols)), 0) + 1;
    const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1600 } });
    const page = await ctx.newPage();
    await page.setContent(`<html><head><style>${xtermCss}
      body{margin:0;background:#0d1117} .wrap{padding:18px 22px;background:#0d1117;display:block}</style></head>
      <body><div class="wrap"><div id="t"></div></div><script>${xtermJs}</script></body></html>`);
    await page.evaluate(({ data, cols, rows, theme }) => new Promise((resolve) => {
      const term = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontSize: 14,
        fontFamily: 'DejaVu Sans Mono, Noto Sans Mono, monospace', theme, cursorBlink: false });
      term.open(document.getElementById('t'));
      term.write(data + '\x1b[?25l', () => resolve());
    }), { data, cols, rows, theme });
    await page.waitForTimeout(300);
    const box = await page.locator('.wrap').boundingBox();
    const scr = await page.locator('.xterm-screen').boundingBox();
    const w = Math.ceil(scr.width + 44), h = Math.ceil(scr.height + 36);
    await page.setViewportSize({ width: w + 20, height: h + 20 });
    await page.screenshot({ path: path.join(__dirname, name + '.png'), clip: { x: box.x, y: box.y, width: w, height: h } });
    console.log(name, 'cols', cols, 'rows', rows, 'px', w * 2, 'x', h * 2);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
