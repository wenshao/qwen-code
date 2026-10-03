const fs = require('fs');
const { chromium } = require('/root/verify/pr13304/head/node_modules/playwright-core');
const NM = '/root/verify/pr13304/head/node_modules/@xterm/xterm';
const xtermJs = fs.readFileSync(NM + '/lib/xterm.js', 'utf8');
const xtermCss = fs.readFileSync(NM + '/css/xterm.css', 'utf8');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const [input, output, cols] of [['e2e.ansi', 'pr13304-e2e-ab.png', 122], ['unit.ansi', 'pr13304-unit-probes.png', 122]]) {
    const data = fs.readFileSync(input, 'utf8');
    const lines = data.split('\r\n');
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(strip(l).length / cols)), 0) + 1;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
    await page.setContent(`<html><head><style>${xtermCss} body{margin:0;background:#0d1117} .wrap{display:block;padding:18px 22px;background:#0d1117;width:fit-content}</style></head><body><div class="wrap"><div id="t"></div></div><script>${xtermJs}</script></body></html>`);
    await page.evaluate(({ data, cols, rows }) => new Promise((resolve) => {
      const term = new window.Terminal({ cols, rows, convertEol: false, scrollback: 0, fontFamily: 'DejaVu Sans Mono, monospace', fontSize: 13, lineHeight: 1.15,
        theme: { background: '#0d1117', foreground: '#d0d7de', cyan: '#56d4dd', green: '#3fb950', red: '#ff7b72', yellow: '#d29922', brightBlack: '#8b949e' } });
      term.open(document.getElementById('t'));
      term.write(data + '\x1b[?25l', resolve);
    }), { data, cols, rows });
    await page.waitForTimeout(300);
    const box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    await page.locator('.wrap').screenshot({ path: output });
    await page.close();
    console.log(output, rows);
  }
  await browser.close();
})();
