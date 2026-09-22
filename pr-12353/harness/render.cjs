// Render ANSI transcripts to PNG with real xterm.js inside headless Chromium.
// usage: NODE_PATH=/root/verify/pr12353-head/node_modules node render.cjs <in.ansi> <out.png> <title> [cols]
const fs = require('node:fs');
const { chromium } = require('/root/verify/pr12353-head/node_modules/playwright-core');
const [, , inFile, outFile, title, colsArg] = process.argv;
const cols = Number(colsArg || 150);
const XT = '/root/verify/pr12353-head/node_modules/@xterm/xterm';
const data = fs.readFileSync(inFile, 'utf8');
const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const rows = data.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...visible(l)].length / cols)), 0) + 1;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fs.readFileSync(XT + '/css/xterm.css', 'utf8')}
body{margin:0;background:#0d1117;font-family:'DejaVu Sans',sans-serif}
.wrap{display:block;padding:14px 18px 10px;background:#0d1117}
.title{color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 10px 2px}
.title span{color:#8b949e;font-weight:400;font-size:13px;margin-left:8px}
#t{display:block}
</style></head><body><div class="wrap"><div class="title">${esc(title)}<span>PR #12353 · local verification · Linux x64</span></div><div id="t"></div></div>
<script>${fs.readFileSync(XT + '/lib/xterm.js', 'utf8')}</script>
<script>
const term = new Terminal({cols:${cols}, rows:${rows}, convertEol:true, scrollback:0, fontFamily:'DejaVu Sans Mono', fontSize:13, lineHeight:1.15,
  theme:{background:'#0d1117',foreground:'#d0d7de',cursor:'#0d1117',green:'#3fb950',red:'#f85149',yellow:'#d29922',cyan:'#39c5cf',magenta:'#bc8cff',brightBlack:'#8b949e'}});
term.open(document.getElementById('t'));
window.__done=false;
term.write(${JSON.stringify(data + '\x1b[?25l')}, ()=>{window.__done=true;});
</script></body></html>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1000 } });
  await page.setContent(html);
  await page.waitForFunction(() => window.__done === true);
  await page.waitForTimeout(300);
  const wrap = page.locator('.wrap');
  const screen = await page.locator('.xterm-screen').boundingBox();
  const title = await page.locator('.title').boundingBox();
  const width = Math.ceil(screen.width + 40);
  const height = Math.ceil(screen.height + title.height + 40);
  await page.setViewportSize({ width: width + 20, height: height + 20 });
  const box = await wrap.boundingBox();
  await page.screenshot({ path: outFile, clip: { x: 0, y: 0, width: Math.min(box.width, width), height: Math.ceil(screen.y + screen.height + 12) } });
  await browser.close();
  console.log('wrote', outFile, rows, 'rows');
})();
