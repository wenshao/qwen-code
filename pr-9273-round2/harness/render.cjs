// PR #9273 round 2 figures: ANSI transcripts rendered with real xterm.js in
// headless Chromium (one fresh page per figure), plus the png rung's own file.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const NM = '/root/verify/pr9273/head/node_modules';
const XJS = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const XCSS = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const E = '/root/verify/pr9273/e2e/r2';
const OUT = path.join(E, 'figs');
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const theme = {
  background: '#0d1117', foreground: '#d0d7de', cursor: '#0d1117',
  black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
};
const wrappedRows = (data, cols) =>
  strip(data).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0);

function termPage(heading, terms) {
  const blocks = terms.map((t, i) => `
    <div class="pane"><div class="cap">${esc(t.title)}</div><div class="term" id="t${i}"></div></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${XCSS}
  body{margin:0;background:#010409;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
  .wrap{display:inline-block;padding:18px}
  h1{color:#e6edf3;font-size:17px;margin:0 0 12px 2px;font-weight:600}
  .row{display:flex;flex-direction:column;gap:16px;align-items:flex-start}
  .pane{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
  .cap{color:#8b949e;font-size:13px;margin:0 0 8px 0;font-family:ui-monospace,Menlo,monospace}
  .term{display:block}
  </style></head><body><div class="wrap"><h1>${esc(heading)}</h1><div class="row">${blocks}</div></div>
  <script>${XJS}</script><script>
  const T=${JSON.stringify(terms)};let left=T.length;
  T.forEach((t,i)=>{const term=new Terminal({cols:t.cols,rows:t.rows,convertEol:true,scrollback:0,
    fontFamily:'DejaVu Sans Mono, monospace',fontSize:14,lineHeight:1.15,theme:${JSON.stringify(theme)},allowProposedApi:true});
    term.open(document.getElementById('t'+i));term.write(t.data+'\\x1b[?25l',()=>{if(--left===0)setTimeout(()=>window.__done=true,300);});});
  </script></body></html>`;
}

function imgPage(heading, imgs, note) {
  const blocks = imgs.map((im) => `<div class="pane"><div class="cap">${esc(im.title)}</div>
    <img src="data:image/png;base64,${fs.readFileSync(im.file).toString('base64')}" style="width:${im.width}px"></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#010409;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
  .wrap{display:inline-block;padding:18px}
  h1{color:#e6edf3;font-size:17px;margin:0 0 12px 2px;font-weight:600}
  .note{color:#8b949e;font-size:13px;margin:10px 2px 0 2px;max-width:1000px}
  .row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;max-width:1500px}
  .pane{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
  .cap{color:#c9d1d9;font-size:13px;margin:0 0 8px 0;font-family:ui-monospace,Menlo,monospace}
  img{display:block;border-radius:4px}
  </style></head><body><div class="wrap"><h1>${esc(heading)}</h1><div class="row">${blocks}</div>
  ${note ? `<div class="note">${esc(note)}</div>` : ''}</div><script>window.__done=true</script></body></html>`;
}

async function shoot(browser, html, name) {
  if (process.env.ONLY && process.env.ONLY !== name) return;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  const loc = page.locator('.wrap');
  let box = await loc.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  box = await loc.boundingBox();
  await page.screenshot({ path: path.join(OUT, name), clip: box });
  await page.close();
  console.log('wrote', name, Math.round(box.width), 'x', Math.round(box.height));
}

const tx = (f, cols, title) => {
  const data = fs.readFileSync(path.join(E, f), 'utf8').replace(/\n$/, '');
  return { title, data, cols, rows: wrappedRows(data, cols) + 3 };
};

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  await shoot(browser, termPage('PR #9273 round 2 — every behaviour change in 0b51eef6c6, R1 head (5936b9f118) vs current head, same host, real tmux 3.5a + real freeze v0.2.2',
    [tx('transcript-delta.ansi', 150, 'delta.sh — 18 checks; each "R1 head reproduces" line is the bug, each "current head" line is the fix')]), 'fig1-delta.png');
  await shoot(browser, imgPage('The file the current head\'s png rung landed for qwen\'s own TUI — unmodified, straight from `--out d1-new/qwen`', [
    { title: 'd1-new/qwen.png  (PNG 2940×1880, evidence=png, validateAssetContent → {ok:true})', file: path.join(E, 'delta/d1-new/qwen.png'), width: 980 },
  ], 'Rendered by freeze v0.2.2 through rsvg-convert with the new `--font.family monospace` argv: the header box\'s right border is one straight line, unlike round 1\'s proportional-font render. The R1 head, given the same TUI, landed SVG XML at qwen.png, and the publish gate refused it.'), 'fig2-png-rung-real-tui.png');
  await shoot(browser, termPage('PR #9273 @ 0b51eef6c6 — the round-1 end-to-end suite rerun (built dist, real tmux 3.5a, real freeze v0.2.2)',
    [tx('transcript-e2e.ansi', 140, 'run-e2e.sh — 38 checks: 38 ✔ (round 1: 37 ✔, 1 ✘ at S2 = the png rung)')]), 'fig3-e2e.png');
  await shoot(browser, termPage('PR #9273 @ 0b51eef6c6 — unit suites (root and uid 1000) and mutation spot-checks',
    [tx('transcript-unit.ansi', 140, 'unit.sh — round-1 finding 2 shape: uid 1000, /tmp/tmux-1000 absent'),
     tx('transcript-mutate.ansi', 140, 'mutate.sh — each production change reverted alone (green = the suite catches it)')]), 'fig4-unit-mutation.png');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
