// Render ANSI transcripts to PNG with real xterm.js in headless Chromium.
// usage: node render-term.cjs <in.ansi> <out.png> <cols> "<title>"
const fs = require('fs');
const NM = '/root/verify/pr13379/head/node_modules';
const { chromium } = require(NM + '/playwright-core');
const [inp, out, colsArg, title] = process.argv.slice(2);
const cols = Number(colsArg);
let data = fs.readFileSync(inp, 'utf8').replace(/\x1b\[[0-9;]*[GKJ]/g, '').replace(/⎯/g, '─').replace(/\n+$/, '');
const vis = (l) => l.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
const rows = data.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...vis(l)].length / cols)), 0) + 1;
data = data.replace(/\n/g, '\r\n') + '\x1b[?25l';
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fs.readFileSync(NM + '/@xterm/xterm/css/xterm.css', 'utf8')}
body{margin:0;background:#0d1117;font-family:'DejaVu Sans Mono',monospace}
.wrap{display:block;padding:14px 16px 10px;background:#0d1117}
.title{color:#8b949e;font:600 13px 'DejaVu Sans',sans-serif;margin:0 0 8px 2px}
</style></head><body><div class="wrap" id="wrap"><div class="title">${esc(title)}</div><div id="t"></div></div>
<script>${fs.readFileSync(NM + '/@xterm/xterm/lib/xterm.js', 'utf8')}</script>
<script>
const term = new Terminal({cols:${cols}, rows:${rows}, convertEol:false, scrollback:0, fontFamily:"'DejaVu Sans Mono', monospace", fontSize:13, lineHeight:1.15,
  theme:{background:'#0d1117',foreground:'#d0d7de',cyan:'#39c5cf',brightCyan:'#56d4dd',green:'#3fb950',brightGreen:'#56d364',red:'#f85149',brightRed:'#ff7b72',yellow:'#d29922',brightYellow:'#e3b341',blue:'#58a6ff'}});
term.open(document.getElementById('t'));
term.write(${JSON.stringify(data)}, () => { window.__done = true; });
</script></body></html>`;
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
  await page.setContent(html);
  await page.waitForFunction(() => window.__done === true);
  await page.waitForTimeout(300);
  let box = await page.locator('#wrap').boundingBox();
  const screen = await page.locator('.xterm-screen').boundingBox();
  await page.setViewportSize({ width: Math.ceil(Math.max(box.width, screen.width + 40)) + 10, height: Math.ceil(box.height) + 10 });
  box = await page.locator('#wrap').boundingBox();
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: Math.ceil(screen.x + screen.width + 16), height: Math.ceil(box.height) } });
  await browser.close();
  console.log('wrote', out, 'rows', rows);
})();
