const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const NM = '/root/verify/pr13366/head/node_modules';
const xtermJs = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const xtermCss = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'spec.json'), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const visible = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
const theme = { background: '#0d1117', foreground: '#d0d7de', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#8b949e' };
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const fig of spec) {
    const panes = [];
    fig.rows.forEach((row, r) => row.forEach((text, c) => {
      const lines = text.split('\n');
      const cols = Math.min(118, Math.max(...lines.map((l) => visible(l).length)) + 2);
      const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(visible(l).length / cols)), 0) + 2;
      panes.push({ id: `p${r}_${c}`, r, c, cols, rows, text });
    }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${xtermCss}
      body{margin:0;background:#010409;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
      .wrap{padding:22px 26px;display:inline-block}
      h1{font-size:20px;margin:0 0 6px 0}
      .sub{font-size:13px;color:#8b949e;margin:2px 0;max-width:1700px}
      .row{display:flex;gap:16px;margin-top:14px;align-items:flex-start}
      .pane{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
      .xterm .xterm-viewport{overflow:hidden!important}
    </style><script>${xtermJs}</script></head><body><div class="wrap" id="wrap">
      <h1>${esc(fig.title)}</h1>${fig.sub.map((s) => `<div class="sub">${esc(s)}</div>`).join('')}
      ${fig.rows.map((row, r) => `<div class="row">${row.map((_, c) => `<div class="pane"><div id="p${r}_${c}"></div></div>`).join('')}</div>`).join('')}
    </div></body></html>`;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 3000, height: 3000 } });
    await page.setContent(html);
    await page.evaluate(async ({ panes, theme }) => {
      await Promise.all(panes.map((p) => new Promise((resolve) => {
        const term = new Terminal({ cols: p.cols, rows: p.rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, Menlo, monospace', theme });
        term.open(document.getElementById(p.id));
        term.write(p.text + '\x1b[?25l', resolve);
      })));
      await new Promise((r) => setTimeout(r, 300));
    }, { panes, theme });
    const box = await page.locator('#wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
    const box2 = await page.locator('#wrap').boundingBox();
    await page.screenshot({ path: path.join(__dirname, fig.name + '.png'), clip: box2 });
    console.log(fig.name, Math.round(box2.width), 'x', Math.round(box2.height));
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
