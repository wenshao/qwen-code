const fs = require('fs');
const { chromium } = require('playwright-core');
const NM = '/root/verify/pr12267-r5/node_modules/@xterm/xterm';
const js = fs.readFileSync(NM + '/lib/xterm.js', 'utf8'), css = fs.readFileSync(NM + '/css/xterm.css', 'utf8');
const COLS = 132;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  for (const name of process.argv.slice(2)) {
    const raw = fs.readFileSync(name + '.ansi', 'utf8').replace(/\x1b\[[0-9;]*[GKJ]/g, '');
    const vis = raw.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));
    const rows = vis.reduce((a, l) => a + Math.max(1, Math.ceil(l.length / COLS)), 0) + 3;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 800 } });
    await page.setContent(`<html><head><style>${css} body{margin:0;background:#0d1117} .wrap{padding:16px;background:#0d1117;display:block}</style></head><body><div class="wrap"><div id="t"></div></div><script>${js}</script></body></html>`);
    await page.evaluate(({ data, rows, cols }) => new Promise(res => {
      const term = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace',
        theme: { background: '#0d1117', foreground: '#d0d7de', cyan: '#39c5cf', brightCyan: '#56d4dd', green: '#3fb950', brightGreen: '#56d364', red: '#f85149', brightRed: '#ff7b72', yellow: '#d29922', brightYellow: '#e3b341' } });
      term.open(document.getElementById('t')); term.write(data + '\x1b[?25l', res);
    }), { data: raw, rows, cols: COLS });
    await page.waitForTimeout(200);
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    box = await page.locator('.wrap').boundingBox();
    await page.screenshot({ path: name + '.png', clip: box });
    await page.close(); console.log('rendered', name, rows, 'rows');
  }
  await browser.close();
})();
