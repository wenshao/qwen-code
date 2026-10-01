// Render ANSI transcripts to PNG with real xterm.js (fresh page per figure).
const fs = require('fs');
const path = require('path');
const NM = '/root/verify/pr12930/qwen-code-pr12930/node_modules';
const { chromium } = require(NM + '/playwright-core');
const xtermJs = fs.readFileSync(NM + '/@xterm/xterm/lib/xterm.js', 'utf8');
const xtermCss = fs.readFileSync(NM + '/@xterm/xterm/css/xterm.css', 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function rowsFor(data, cols) {
  const plain = data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  return plain.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0) + 3;
}
async function renderOne(browser, { input, output, title, cols = 120 }) {
  const data = fs.readFileSync(input, 'utf8').replace(/\x1b\[[0-9;]*[GKJ]/g, '');
  const rows = rowsFor(data, cols);
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  await page.setContent(`<!doctype html><html><head><style>${xtermCss}
    body{margin:0;background:#0d1117;font-family:'DejaVu Sans',sans-serif}
    .wrap{padding:14px 18px 18px;background:#0d1117;display:block}
    .title{color:#8b949e;font:600 13px 'DejaVu Sans Mono',monospace;margin:0 0 10px;border-bottom:1px solid #30363d;padding-bottom:8px}
    #t{display:block}</style></head><body><div class="wrap"><div class="title">${esc(title)}</div><div id="t"></div></div>
    <script>${xtermJs}</script></body></html>`);
  await page.evaluate(({ data, rows, cols }) => new Promise((res) => {
    const term = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontFamily: 'DejaVu Sans Mono', fontSize: 13,
      theme: { background: '#0d1117', foreground: '#d0d7de', green: '#3fb950', red: '#f85149', yellow: '#d29922', cyan: '#39c5cf', blue: '#58a6ff', magenta: '#bc8cff', brightBlack: '#6e7681' } });
    term.open(document.getElementById('t'));
    term.write(data + '\x1b[?25l', () => setTimeout(res, 150));
  }), { data, rows, cols });
  const el = page.locator('.wrap');
  let box = await el.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  box = await el.boundingBox();
  await el.screenshot({ path: output });
  await page.close();
  console.log('wrote', output, Math.round(box.width), 'x', Math.round(box.height));
}
(async () => {
  const figs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch({ executablePath: fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').includes('chromium-1208') ? undefined : undefined });
  for (const f of figs) await renderOne(browser, f);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
