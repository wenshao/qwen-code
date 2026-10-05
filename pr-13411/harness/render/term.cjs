// Render ANSI transcripts into PNG panes with real xterm.js + headless chromium.
// Usage: node term.cjs <spec.json> <out.png>
// spec: {cols, panes:[{title, file}], layout:'row'|'col', caption}
const fs = require('fs');
const { chromium } = require('playwright-core');
const NM = '/root/verify/pr13411/qwen-head/node_modules';
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
(async () => {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const cols = spec.cols || 110;
  const panes = spec.panes.map((p) => {
    let data = fs.readFileSync(p.file, 'utf8').replace(/\x1b\[[0-9;?]*[GKJHlh]/g, '').replace(/\r/g, '');
    const vis = data.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
    const rows = vis.reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0) + 1;
    return { ...p, data, rows };
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fs.readFileSync(NM + '/@xterm/xterm/css/xterm.css', 'utf8')}
body{margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.wrap{padding:16px;background:#f6f8fa;display:flex;flex-direction:${spec.layout === 'col' ? 'column' : 'row'};gap:14px;align-items:flex-start;width:max-content}
.pane{background:#0d1117;border-radius:8px;border:1px solid #30363d;overflow:hidden}
.title{color:#e6edf3;background:#161b22;font-size:13px;font-weight:600;padding:7px 12px;border-bottom:1px solid #30363d}
.title .sub{color:#8b949e;font-weight:400;margin-left:8px}
.term{padding:6px 8px;display:block}
.cap{font-size:12.5px;color:#57606a;max-width:${cols * 8 * (spec.layout === 'col' ? 1 : panes.length)}px;line-height:1.45}
</style></head><body><div class="wrap" id="wrap">
${panes.map((p, i) => `<div class="pane"><div class="title">${esc(p.title)}${p.sub ? `<span class="sub">${esc(p.sub)}</span>` : ''}</div><div class="term" id="t${i}"></div></div>`).join('')}
</div>${spec.caption ? `<div class="cap" style="padding:0 16px 14px;background:#f6f8fa;width:max-content">${esc(spec.caption)}</div>` : ''}
<script>${fs.readFileSync(NM + '/@xterm/xterm/lib/xterm.js', 'utf8')}</script>
<script>
window.__done = 0;
const panes = ${JSON.stringify(panes.map((p) => ({ data: p.data, rows: p.rows })))};
panes.forEach((p, i) => {
  const t = new Terminal({ cols: ${cols}, rows: p.rows, convertEol: true, scrollback: 0, fontSize: 13,
    fontFamily: 'DejaVu Sans Mono, monospace', theme: { background: '#0d1117', foreground: '#e6edf3',
    red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf',
    brightBlack: '#8b949e', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341' } });
  t.open(document.getElementById('t' + i));
  t.write(p.data + '\\x1b[?25l', () => { window.__done++; });
});
</script></body></html>`;
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 800 } });
  await page.setContent(html);
  await page.waitForFunction((n) => window.__done === n, panes.length);
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const r = document.body.getBoundingClientRect(); const w = document.getElementById('wrap').getBoundingClientRect(); return { w: Math.ceil(Math.max(w.width, r.width)), h: Math.ceil(document.body.scrollHeight) }; });
  await page.setViewportSize({ width: box.w + 4, height: box.h + 4 });
  await page.screenshot({ path: process.argv[3], clip: { x: 0, y: 0, width: box.w, height: box.h } });
  await browser.close();
  console.log('wrote', process.argv[3], box);
})();
