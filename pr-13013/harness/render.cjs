// Render ANSI transcripts to PNG with real xterm.js inside headless Chromium.
// usage: NODE_PATH=<repo>/node_modules node render.cjs <out.png> <title> <file.ansi> [cols]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const NM = '/root/verify/pr13013/pr/node_modules';
const [out, title, file, colsArg] = process.argv.slice(2);
const cols = Number(colsArg || 132);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let data = fs.readFileSync(file, 'utf8');
data = data.replace(/\x1b\[[0-9;?]*[GKJHlh]/g, '').replace(/\r(?!\n)/g, '');
const visLen = (l) => l.replace(/\x1b\[[0-9;]*m/g, '').length;
const rows = data.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(visLen(l) / cols)), 0) + 3;

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8')}
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,sans-serif}
.wrap{padding:14px 16px 10px;background:#0d1117}
.title{color:#8b949e;font-size:13px;margin:0 0 8px 2px}
#t{display:block}</style></head><body><div class="wrap"><div class="title">${esc(title)}</div><div id="t"></div></div>
<script>${fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8')}</script>
<script>
const term = new Terminal({cols:${cols}, rows:${rows}, convertEol:true, scrollback:0, fontSize:13,
  fontFamily:'DejaVu Sans Mono, Menlo, monospace', allowProposedApi:true,
  theme:{background:'#0d1117',foreground:'#d0d7de',black:'#484f58',red:'#ff7b72',green:'#3fb950',
  yellow:'#d29922',blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#b1bac4',
  brightBlack:'#6e7681',brightRed:'#ffa198',brightGreen:'#56d364',brightYellow:'#e3b341',
  brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',brightCyan:'#56d4dd',brightWhite:'#f0f6fc'}});
term.open(document.getElementById('t'));
term.write(${JSON.stringify(data + '\x1b[?25l')}, () => { window.__done = true; });
</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForFunction(() => window.__done === true);
  await page.waitForTimeout(150);
  const wrap = page.locator('.wrap');
  let box = await wrap.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
  box = await wrap.boundingBox();
  await page.screenshot({ path: out, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  await browser.close();
  console.log(`${out} rows=${rows}`);
})();
