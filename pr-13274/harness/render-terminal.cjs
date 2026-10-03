// Render side-by-side ANSI panes with real xterm.js to PNG.
// Usage: NODE_PATH=<wt>/node_modules node render-terminal.cjs <spec.json> <out.png>
// spec: { title, cols, panes: [{ title, file }] }   (file = ANSI text)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const [specPath, outPng] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const nm = process.env.NODE_PATH.split(':')[0];
const xtermJs = fs.readFileSync(path.join(nm, '@xterm/xterm/lib/xterm.js'), 'utf8');
const xtermCss = fs.readFileSync(path.join(nm, '@xterm/xterm/css/xterm.css'), 'utf8');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const cols = spec.cols ?? 92;
const panes = spec.panes.map((p) => {
  const text = fs.readFileSync(p.file, 'utf8').replace(/\n+$/, '');
  const rows = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(strip(l).length / cols)), 0) + 2;
  return { ...p, text, rows };
});
const maxRows = Math.max(...panes.map((p) => p.rows));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${xtermCss}
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{padding:18px 20px;display:inline-block;background:#0d1117}
h1{color:#e6edf3;font-size:17px;margin:0 0 4px;font-weight:600}
.sub{color:#8b949e;font-size:12.5px;margin:0 0 12px}
.grid{display:flex;gap:14px}
.pane{border:1px solid #30363d;border-radius:8px;overflow:hidden;background:#0d1117}
.ptitle{background:#161b22;color:#c9d1d9;font-size:12.5px;padding:7px 12px;border-bottom:1px solid #30363d;font-weight:600}
.term{padding:8px 10px}
.xterm-viewport{overflow:hidden!important}
</style><script>${xtermJs}</script></head><body><div class="wrap">
<h1>${esc(spec.title)}</h1><div class="sub">${esc(spec.subtitle ?? '')}</div>
<div class="grid">${panes.map((p, i) => `<div class="pane"><div class="ptitle">${esc(p.title)}</div><div class="term" id="t${i}"></div></div>`).join('')}</div>
</div><script>
const data = ${JSON.stringify(panes.map((p) => p.text))};
let pending = data.length;
data.forEach((d, i) => {
  const term = new Terminal({ cols: ${cols}, rows: ${maxRows}, convertEol: true, scrollback: 0, fontSize: 13,
    fontFamily: 'DejaVu Sans Mono, Menlo, monospace',
    theme: { background: '#0d1117', foreground: '#d0d7de', cursor: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', brightBlack: '#8b949e' } });
  term.open(document.getElementById('t' + i));
  term.write(d + '\\x1b[?25l', () => { if (--pending === 0) window.__done = true; });
});
</script></body></html>`;

(async () => {
  fs.writeFileSync(outPng.replace(/\.png$/, '.html'), html);
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const page = await browser.newPage({ viewport: { width: 2400, height: 1600 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForFunction(() => window.__done === true);
  await page.waitForTimeout(300);
  const wrap = page.locator('.wrap');
  let box = await wrap.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  box = await wrap.boundingBox();
  await wrap.screenshot({ path: outPng });
  await browser.close();
  console.log('wrote', outPng, box);
})();
