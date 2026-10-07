// Renders ANSI transcripts to PNG with real xterm.js in headless Chromium.
// usage: NODE_PATH=<worktree>/node_modules node render.cjs <outdir> <file.ansi>:<name>:<cols> ...
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const NM = process.env.NODE_PATH;
const xtermJs = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const xtermCss = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

(async () => {
  const [outdir, ...specs] = process.argv.slice(2);
  fs.mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`,
  });
  for (const spec of specs) {
    const [file, name, colsArg] = spec.split(':');
    const cols = Number(colsArg || 120);
    let data = fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n');
    const rows = strip(data).split('\r\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0) + 2;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
    await page.setContent(`<html><head><style>${xtermCss} body{margin:0;background:#0d1117} .wrap{padding:14px;background:#0d1117}</style></head><body><div class="wrap"><div id="t"></div></div><script>${xtermJs}</script></body></html>`);
    await page.evaluate(({ data, cols, rows }) => new Promise((resolve) => {
      const term = new Terminal({ cols, rows, convertEol: false, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace',
        theme: { background: '#0d1117', foreground: '#d0d7de', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' } });
      term.open(document.getElementById('t'));
      term.write(data + '\x1b[?25l', () => setTimeout(resolve, 150));
    }), { data, cols, rows });
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    box = await page.locator('.wrap').boundingBox();
    const out = path.join(outdir, `${name}.png`);
    await page.screenshot({ path: out, clip: box });
    console.log(out, Math.round(box.width), 'x', Math.round(box.height), 'rows', rows);
    await page.close();
  }
  await browser.close();
})();
