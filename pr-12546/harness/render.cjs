// node render.cjs <in.ansi> <out.png> <cols> <title>
const fs = require('fs'); const { chromium } = require('playwright-core');
const [inp, out, colsS, title] = process.argv.slice(2); const cols = +colsS;
const NM = '/root/verify/pr12546-head/node_modules/@xterm/xterm';
const data = fs.readFileSync(inp, 'utf8').replace(/\x1b\[[0-9;]*[GKJ]/g, '');
const vis = data.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
const rows = vis.reduce((s, l) => s + Math.max(1, Math.ceil([...l].length / cols)), 0) + 3;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
(async () => {
  const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' }); const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
  await p.setContent(`<html><head><style>${fs.readFileSync(NM + '/css/xterm.css', 'utf8')} body{background:#0d1117;margin:0;padding:16px;font-family:sans-serif} h3{color:#e6edf3;font:600 15px system-ui;margin:0 0 10px}</style></head><body><h3>${esc(title)}</h3><div class="wrap" style="display:block"><div id="t"></div></div><script>${fs.readFileSync(NM + '/lib/xterm.js', 'utf8')}</script></body></html>`);
  await p.evaluate(({ data, cols, rows }) => new Promise(r => { const t = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace', theme: { background: '#0d1117', foreground: '#d0d7de', green: '#3fb950', red: '#f85149', yellow: '#d29922', cyan: '#39c5cf', brightBlack: '#8b949e' } }); t.open(document.getElementById('t')); t.write(data + '\x1b[?25l', r); }), { data, cols, rows });
  await p.waitForTimeout(300);
  let box = await p.locator('body').boundingBox(); const sz = await p.evaluate(() => ({ w: document.querySelector('.xterm-screen').getBoundingClientRect().width + 40, h: document.body.scrollHeight }));
  await p.setViewportSize({ width: Math.ceil(sz.w), height: Math.ceil(sz.h) });
  await p.screenshot({ path: out, clip: { x: 0, y: 0, width: Math.ceil(sz.w), height: Math.ceil(sz.h) } });
  await b.close(); console.log('wrote', out, rows, 'rows');
})();
