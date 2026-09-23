const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const NM = '/root/verify/pr12506/node_modules';
const js = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const css = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
(async () => {
  const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter((d) => d.startsWith('chromium-')).sort().pop();
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  for (const name of process.argv.slice(2)) {
    const data = fs.readFileSync(`${name}.ansi`, 'utf8');
    const cols = Math.min(190, Math.max(...strip(data).split('\n').map((l) => [...l].length)) + 2);
    const rows = strip(data).split('\n').reduce((a, l) => a + Math.max(1, Math.ceil([...l].length / cols)), 0) + 2;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1600 } });
    await page.setContent(`<html><head><style>${css} body{margin:0;background:#0d1117} .wrap{padding:14px;background:#0d1117;display:block}</style></head><body><div class="wrap"><div id="t"></div></div><script>${js}</script></body></html>`);
    await page.evaluate(({ data, cols, rows }) => new Promise((res) => {
      const term = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontFamily: 'DejaVu Sans Mono, monospace', fontSize: 13,
        theme: { background: '#0d1117', foreground: '#d0d7de', green: '#3fb950', red: '#f85149', yellow: '#d29922', cyan: '#39c5cf', brightCyan: '#56d4dd' } });
      term.open(document.getElementById('t'));
      term.write(data + '\x1b[?25l', res);
    }), { data, cols, rows });
    await page.waitForTimeout(300);
    const box = await page.locator('.xterm-screen').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width + 60), height: Math.ceil(box.height + 60) });
    const b2 = await page.locator('.xterm-screen').boundingBox();
    await page.screenshot({ path: `${name}.png`, clip: { x: b2.x - 14, y: b2.y - 14, width: b2.width + 28, height: b2.height + 28 } });
    console.log(name, cols, rows);
    await page.close();
  }
  await browser.close();
})();
