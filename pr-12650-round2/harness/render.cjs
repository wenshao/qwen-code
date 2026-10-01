// Renders figure specs (figures.json) to PNG: each figure is a title, an
// optional subtitle, and one or more rows of xterm.js panes fed the captured
// ANSI transcripts. Fresh page per figure (a reused page keeps stale state).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const NM = '/root/git/qwen-code-x9/node_modules/@xterm/xterm';
const xtermJs = fs.readFileSync(path.join(NM, 'lib/xterm.js'), 'utf8');
const xtermCss = fs.readFileSync(path.join(NM, 'css/xterm.css'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const visLen = (l) => l.replace(/\x1b\[[0-9;]*m/g, '').replace(/\t/g, '        ').length;
const rowsFor = (text, cols) =>
  text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(visLen(l) / cols)), 0) + 1;

async function main() {
  const figs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch({
    executablePath:
      '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  for (const fig of figs) {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1200 } });
    const panes = [];
    const rowsHtml = fig.rows
      .map((row) => {
        const cells = row
          .map((p) => {
            const id = `t${panes.length}`;
            const text = fs.readFileSync(path.join(__dirname, p.file), 'utf8').replace(/\n+$/, '');
            panes.push({ id, text, cols: p.cols, rows: rowsFor(text, p.cols) + 1 });
            return `<div class="pane"><div class="ptitle ${p.tone || ''}">${esc(p.title)}</div><div class="term" id="${id}"></div></div>`;
          })
          .join('');
        return `<div class="row">${cells}</div>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${xtermCss}
      body{margin:0;background:#010409;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif}
      .wrap{display:inline-block;padding:18px 20px 20px;background:#010409}
      h1{color:#e6edf3;font-size:19px;margin:0 0 4px;font-weight:600}
      .sub{color:#8b949e;font-size:13px;margin:0 0 14px;max-width:1600px}
      .row{display:flex;gap:14px;margin-bottom:14px;align-items:flex-start}
      .pane{background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden}
      .ptitle{color:#e6edf3;font-size:13px;font-weight:600;padding:7px 12px;background:#161b22;border-bottom:1px solid #30363d}
      .ptitle.bad{color:#ff7b72}.ptitle.good{color:#3fb950}
      .term{padding:8px 10px}
      .xterm-viewport{overflow:hidden!important}
    </style></head><body><div class="wrap"><h1>${esc(fig.title)}</h1>${fig.subtitle ? `<div class="sub">${esc(fig.subtitle)}</div>` : ''}${rowsHtml}</div>
    <script>${xtermJs}</script></body></html>`;
    await page.setContent(html);
    await page.evaluate(async (panes) => {
      const theme = { background: '#0d1117', foreground: '#d0d7de', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightYellow: '#e3b341' };
      await Promise.all(
        panes.map(
          (p) =>
            new Promise((resolve) => {
              const term = new window.Terminal({ cols: p.cols, rows: p.rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace', theme, cursorStyle: 'bar', cursorInactiveStyle: 'none' });
              term.open(document.getElementById(p.id));
              term.write(p.text + '\x1b[?25l', resolve);
            }),
        ),
      );
    }, panes);
    await page.waitForTimeout(300);
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    box = await page.locator('.wrap').boundingBox();
    await page.screenshot({ path: path.join(__dirname, fig.out), clip: box });
    console.log(`${fig.out}: ${Math.round(box.width)}x${Math.round(box.height)} css px`);
    await page.close();
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
