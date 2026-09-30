// Render two real ANSI transcripts side by side with xterm.js (headless Chromium).
const fs = require('fs');
const { chromium } = require('playwright-core');
const NM = '/root/verify/pr13119/head/node_modules';
const xtermJs = fs.readFileSync(`${NM}/@xterm/xterm/lib/xterm.js`, 'utf8');
const xtermCss = fs.readFileSync(`${NM}/@xterm/xterm/css/xterm.css`, 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const COLS = 100;
const vis = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
const rowsFor = (t) => t.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...vis(l)].length / COLS)), 0) + 2;
async function render(out, title, panes) {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1200 } });
  const data = panes.map((p) => ({ ...p, text: fs.readFileSync(p.file, 'utf8').replace(/\n/g, '\r\n') + '\x1b[?25l' }));
  const rows = Math.max(...data.map((d) => rowsFor(fs.readFileSync(d.file, 'utf8'))));
  await page.setContent(`<!doctype html><html><head><style>${xtermCss}
    body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
    .wrap{display:inline-block;padding:18px}
    h1{font-size:17px;margin:0 0 12px 2px;font-weight:600}
    .grid{display:flex;gap:14px}
    .pane{border:1px solid #30363d;border-radius:8px;overflow:hidden;background:#0d1117}
    .cap{padding:7px 12px;font-size:13px;font-weight:600;border-bottom:1px solid #30363d}
    .bad{background:#3d1418;color:#ffa198}.good{background:#0f2d1a;color:#7ee787}
    .term{padding:8px 10px}
  </style></head><body><div class="wrap"><h1>${esc(title)}</h1><div class="grid">
  ${data.map((d, i) => `<div class="pane"><div class="cap ${d.cls}">${esc(d.caption)}</div><div class="term" id="t${i}"></div></div>`).join('')}
  </div></div><script>${xtermJs}</script></body></html>`);
  await page.evaluate(({ data, rows, COLS }) => new Promise((resolve) => {
    let pending = data.length;
    data.forEach((d, i) => {
      const term = new window.Terminal({ cols: COLS, rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace',
        theme: { background: '#0d1117', foreground: '#d0d7de', brightGreen: '#56d364', green: '#3fb950', brightRed: '#ff7b72', brightYellow: '#e3b341', brightCyan: '#79c0ff' } });
      term.open(document.getElementById('t' + i));
      term.write(d.text, () => { if (--pending === 0) setTimeout(resolve, 300); });
    });
  }), { data, rows, COLS });
  const el = page.locator('.wrap');
  let box = await el.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  box = await el.boundingBox();
  await el.screenshot({ path: out });
  await browser.close();
  console.log('wrote', out, Math.round(box.width), 'x', Math.round(box.height));
}
(async () => {
  await render('/root/verify/pr13119/publish/pr-13119/01-gap-checkpoint-terminal.png',
    'PR #13119 — an unrelated settings save is paused mid-write; an independent qwen starts meanwhile (Linux, real bwrap)',
    [{ file: '/root/verify/pr13119/run/demo-base.ansi', caption: 'BASE 78143fe335 — paused after rename(settings.json → .orig): policy gone, tool escapes', cls: 'bad' },
     { file: '/root/verify/pr13119/run/demo-head.ansi', caption: 'PR HEAD d0be922868 — paused after backup copy, just before publication: policy kept', cls: 'good' }]);
})();
