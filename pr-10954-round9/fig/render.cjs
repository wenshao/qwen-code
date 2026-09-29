// Render each .ansi figure with real xterm.js in headless Chromium.
const fs = require('fs');
const path = require('path');
const NM = '/root/verify/pr10954/head/node_modules';
const { chromium } = require(`${NM}/playwright-core`);
const xtermJs = fs.readFileSync(`${NM}/@xterm/xterm/lib/xterm.js`, 'utf8');
const xtermCss = fs.readFileSync(`${NM}/@xterm/xterm/css/xterm.css`, 'utf8');
const DIR = __dirname;

const vis = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

(async () => {
  const browser = await chromium.launch();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.ansi')).sort()) {
    const data = fs.readFileSync(path.join(DIR, file), 'utf8');
    const lines = data.replace(/\n$/, '').split('\n');
    const cols = Math.max(...lines.map((l) => [...vis(l)].length)) + 2;
    const rows = lines.length + 2;
    // A fresh page per figure: a reused page keeps the previous done flag.
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1600 } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${xtermCss}
      body{margin:0;background:#0d1117} .wrap{display:block;padding:18px 20px;background:#0d1117}
      </style></head><body><div class="wrap"><div id="t"></div></div>
      <script>${xtermJs}</script></body></html>`);
    await page.evaluate(
      ({ data, cols, rows }) =>
        new Promise((resolve) => {
          const term = new window.Terminal({
            cols,
            rows,
            convertEol: true,
            scrollback: 0,
            fontFamily: 'DejaVu Sans Mono, Liberation Mono, monospace',
            fontSize: 14,
            theme: {
              background: '#0d1117',
              foreground: '#d0d7de',
              black: '#484f58',
              brightBlack: '#8b949e',
              red: '#ff7b72',
              green: '#3fb950',
              yellow: '#d29922',
              blue: '#58a6ff',
              cyan: '#39c5cf',
              white: '#e6edf3',
              brightWhite: '#ffffff',
            },
          });
          term.open(document.getElementById('t'));
          term.write(data + '\x1b[?25l', () => resolve());
        }),
      { data, cols, rows },
    );
    await page.waitForTimeout(200);
    const box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 10, height: Math.ceil(box.height) + 10 });
    const box2 = await page.locator('.xterm-screen').boundingBox();
    const out = path.join(DIR, file.replace(/\.ansi$/, '.png'));
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: Math.ceil(box2.x + box2.width + 20), height: Math.ceil(box2.y + box2.height + 16) },
    });
    await page.close();
    console.log(out, cols, 'x', rows);
  }
  await browser.close();
})();
