// Replay a recorded PTY stream into real xterm.js (headless Chromium) -> PNG.
// Usage: node render.cjs <raw.json> <out.png> <title> [cutoffMs]
const fs = require('fs');
const { chromium } = require('playwright-core');
const [rawPath, out, title, cutoff] = process.argv.slice(2);
const rec = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
let data = rec.chunks.filter(([t]) => !cutoff || t <= Number(cutoff)).map(([, d]) => d).join('');
data += '\x1b[?2026l\x1b[?25l';
const X = '/root/verify/pr12421-head/node_modules/@xterm/xterm';
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = `<!doctype html><html><head><style>${fs.readFileSync(X + '/css/xterm.css', 'utf8')}
body{margin:0;background:#0d1117;font-family:sans-serif}
.win{display:block;margin:16px;border-radius:10px;overflow:hidden;border:1px solid #30363d;background:#0d1117;width:fit-content}
.bar{background:#161b22;color:#c9d1d9;font:600 14px -apple-system,Segoe UI,sans-serif;padding:9px 14px;border-bottom:1px solid #30363d}
.term{padding:10px 12px}</style></head><body>
<div class="win" id="win"><div class="bar">${esc(title)}</div><div class="term" id="t"></div></div>
<script>${fs.readFileSync(X + '/lib/xterm.js', 'utf8')}</script></body></html>`;
(async () => {
  const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
  const p = await b.newPage({ viewport: { width: 1800, height: 1400 }, deviceScaleFactor: 2 });
  await p.setContent(html);
  await p.evaluate(({ cols, rows, data }) => new Promise((res) => {
    const term = new window.Terminal({ cols, rows, scrollback: 0, fontSize: 14, fontFamily: 'DejaVu Sans Mono, monospace',
      theme: { background: '#0d1117', foreground: '#d0d7de', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' } });
    term.open(document.getElementById('t'));
    term.write(data, () => setTimeout(res, 300));
  }), { cols: rec.cols, rows: rec.rows, data });
  const box = await p.locator('#win').boundingBox();
  await p.setViewportSize({ width: Math.ceil(box.width + 40), height: Math.ceil(box.height + 40) });
  await p.locator('#win').screenshot({ path: out });
  await b.close();
  console.log('wrote', out);
})();
