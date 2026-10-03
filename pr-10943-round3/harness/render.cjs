// Render ANSI transcripts to PNG with real xterm.js in headless Chromium.
// Usage: node render.cjs figs.json outdir
const fs = require('node:fs');
const path = require('node:path');
const NM = '/root/verify/pr10943/head/node_modules';
const { chromium } = require(path.join(NM, 'playwright-core'));
const XTERM_JS = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const XTERM_CSS = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
function sanitize(s) {
  return s
    .replace(/\/root\/verify\/pr10943\/r\/(?:head|base|headmut)-[A-Za-z0-9-]+\/w\//g, './')
    .replace(/\/root\/verify\/pr10943\/r\/(?:head|base|headmut)-[A-Za-z0-9-]+\/w\b/g, '~/proj')
    .replace(/\/root\/verify\/pr10943\/r\/(?:head|base|headmut)-[A-Za-z0-9-]+\/q\//g, '$QWEN_HOME/')
    .replace(/\/root\/verify\/pr10943\/(?:head|base|headmut)\//g, '…/')
    .replace(/\/var\/tmp\/pr10943-s4\/qhome/g, '$QWEN_HOME')
    .replace(/\/root\/verify\/pr10943\/r\/(?:head|base|headmut)-[A-Za-z0-9-]+\/?/g, '~/');
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function main() {
  const [figsFile, outDir] = process.argv.slice(2);
  const figs = JSON.parse(fs.readFileSync(figsFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  for (const fig of figs) {
    const cols = fig.cols ?? 140;
    const panes = fig.panes.map((p) => {
      let data = sanitize(fs.readFileSync(p.file, 'utf8'));
      if (p.maxLines) data = data.split('\n').slice(0, p.maxLines).join('\n');
      data = data.replace(/\n/g, '\r\n') + '\x1b[?25l';
      const rows = strip(data).split('\r\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0) + 1;
      return { title: p.title, data, rows };
    });
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${XTERM_CSS}
      body{margin:0;background:#0b0f14;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
      .wrap{display:block;padding:14px 16px 16px;background:#0b0f14}
      .cap{color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 10px 2px}
      .sub{color:#8b949e;font-size:12.5px;font-weight:400;margin:-6px 0 10px 2px}
      .pane{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px 10px;margin-bottom:12px}
      .pt{color:#58a6ff;font-size:12.5px;font-weight:600;margin:0 0 6px 2px}
      .xterm .xterm-viewport{overflow:hidden!important}
    </style><script>${XTERM_JS}</script></head><body><div class="wrap" id="wrap">
      <div class="cap">${esc(fig.caption)}</div>${fig.sub ? `<div class="sub">${esc(fig.sub)}</div>` : ''}
      ${panes.map((p, i) => `<div class="pane">${p.title ? `<div class="pt">${esc(p.title)}</div>` : ''}<div id="t${i}"></div></div>`).join('')}
    </div></body></html>`;
    await page.setContent(html);
    await page.evaluate(
      async ({ panes, cols }) => {
        const theme = { background: '#0d1117', foreground: '#d0d7de', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#d2a8ff', cyan: '#56d4dd', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' };
        await Promise.all(
          panes.map(
            (p, i) =>
              new Promise((res) => {
                const t = new Terminal({ cols, rows: p.rows, convertEol: false, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, Menlo, monospace', theme, allowProposedApi: true });
                t.open(document.getElementById('t' + i));
                t.write(p.data, () => setTimeout(res, 150));
              }),
          ),
        );
      },
      { panes: panes.map((p) => ({ data: p.data, rows: p.rows })), cols },
    );
    const screenW = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.xterm-screen')].map((e) => e.getBoundingClientRect().width)));
    await page.evaluate((w) => { document.getElementById('wrap').style.width = w + 'px'; }, Math.ceil(screenW) + 2 * 10 + 2);
    let box = await page.locator('#wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
    box = await page.locator('#wrap').boundingBox();
    const out = path.join(outDir, fig.name);
    await page.screenshot({ path: out, clip: box });
    console.log(out, Math.round(box.width), 'x', Math.round(box.height));
    await page.close();
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
