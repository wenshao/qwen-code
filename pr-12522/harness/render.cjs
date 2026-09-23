const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const NM = '/root/verify/pr12522/node_modules/@xterm/xterm';
const xjs = fs.readFileSync(NM + '/lib/xterm.js', 'utf8'), xcss = fs.readFileSync(NM + '/css/xterm.css', 'utf8');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const f of process.argv.slice(2)) {
    const data = fs.readFileSync(f, 'utf8');
    const plain = data.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
    const cols = Math.min(190, Math.max(...plain.map(l => l.length)) + 2);
    const rows = plain.reduce((a, l) => a + Math.max(1, Math.ceil(l.length / cols)), 0) + 3;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1000 } });
    await page.setContent(`<html><head><style>${xcss} body{margin:0;background:#0d1117} .wrap{padding:16px;background:#0d1117;display:block}</style></head><body><div class="wrap"><div id="t"></div></div><script>${xjs}</script></body></html>`);
    await page.evaluate(({ data, cols, rows }) => new Promise(res => {
      const term = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontFamily: 'DejaVu Sans Mono, monospace', fontSize: 13,
        theme: { background: '#0d1117', foreground: '#d0d7de', green: '#3fb950', brightGreen: '#56d364', red: '#f85149', brightRed: '#ff7b72', yellow: '#d29922', brightYellow: '#e3b341', cyan: '#39c5cf', brightCyan: '#56d4dd' } });
      term.open(document.getElementById('t'));
      term.write(data + '\x1b[?25l', res);
    }), { data, cols, rows });
    await page.waitForTimeout(300);
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    box = await page.locator('.wrap').boundingBox();
    const out = f.replace(/\.ansi$/, '.png');
    await page.screenshot({ path: out, clip: box });
    console.log(out, Math.round(box.width), Math.round(box.height));
    await page.close();
  }
  await browser.close();
})();
