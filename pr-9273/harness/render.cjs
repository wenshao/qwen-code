// Render ANSI transcripts / captures to PNG with real xterm.js in headless
// Chromium, and compose image panels. One fresh page per figure.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const NM = '/root/verify/pr9273/head/node_modules';
const XJS = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const XCSS = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const E = '/root/verify/pr9273/e2e';
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

function wrappedRows(data, cols) {
  return strip(data).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0);
}

// terms: [{title, data, cols, rows}]
function termPage(heading, terms, layout = 'column') {
  const blocks = terms.map((t, i) => `
    <div class="pane"><div class="cap">${esc(t.title)}</div><div class="term" id="t${i}"></div></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${XCSS}
  body{margin:0;background:#010409;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
  .wrap{display:inline-block;padding:18px}
  h1{color:#e6edf3;font-size:17px;margin:0 0 12px 2px;font-weight:600}
  .row{display:flex;flex-direction:${layout};gap:16px;align-items:flex-start}
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
  .note{color:#8b949e;font-size:13px;margin:10px 2px 0 2px;max-width:1400px}
  .row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;max-width:1500px}
  .pane{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
  .cap{color:#c9d1d9;font-size:13px;margin:0 0 8px 0;font-family:ui-monospace,Menlo,monospace}
  img{display:block;border-radius:4px}
  </style></head><body><div class="wrap"><h1>${esc(heading)}</h1><div class="row">${blocks}</div>
  ${note ? `<div class="note">${esc(note)}</div>` : ''}</div><script>window.__done=true</script></body></html>`;
}

async function shoot(browser, html, name) {
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
  const data = fs.readFileSync(path.join(E, f), 'utf8');
  return { title, data, cols, rows: wrappedRows(data, cols) + 2 };
};

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const HEAD = '5936b9f118';
  await shoot(browser, termPage(`PR #9273 @ ${HEAD} — capture-tui end to end (real tmux 3.5a, real freeze v0.2.2, built dist/cli.js)`,
    [tx('transcript.ansi', 140, 'run-e2e.sh — 38 checks: 37 ✔, 1 ✘ (S2 = finding 1)')]), 'fig1-e2e.png');
  await shoot(browser, termPage(`Finding 1 — the "png" rung is an SVG file with a real freeze`,
    [tx('transcript-f1.ansi', 120, 'finding1.sh — freeze probe, head arm, publish gate, one-line positive control, negative control')]), 'fig2-png-rung-is-svg.png');
  await shoot(browser, termPage(`Finding 2 — the base-alias fixture creates the host's real /tmp/tmux-<uid> as 0755`,
    [tx('transcript-f2.ansi', 110, 'finding2.sh — non-root via user namespace (uid 0 → 1000, no capabilities)')]), 'fig3-socket-dir-0755.png');
  const ans = (f) => fs.readFileSync(path.join(E, 'out-tui', f), 'utf8').replace(/\n$/, '');
  await shoot(browser, termPage('qwen\'s own TUI, captured by `qwen review capture-tui --until "Type your message"` (the .ans bytes, replayed in xterm.js)',
    [{ title: 'qwen-80.ans  (--cols 80 --rows 24, settledBy=until-match)', data: ans('qwen-80.ans'), cols: 80, rows: 24 },
     { title: 'qwen-120.ans (--cols 120 --rows 24, settledBy=until-match)', data: ans('qwen-120.ans'), cols: 120, rows: 24 }]), 'fig4-qwen-tui-capture.png');
  await shoot(browser, imgPage('Fidelity of the png rung on this Linux host: freeze v0.2.2 default font vs. --font.family monospace (same .ans)', [
    { title: 'freeze default (what the png rung renders once finding 1 is fixed)', file: path.join(E, 'out-tui/qwen-80.freeze-fixed.png'), width: 700 },
    { title: 'freeze --font.family monospace', file: path.join(E, 'out-tui/qwen-80.freeze-mono.png'), width: 700 },
    { title: 'grid probe — default font', file: path.join(E, 'freeze-ext/grid-default.png'), width: 420 },
    { title: 'grid probe — --font.family monospace', file: path.join(E, 'freeze-ext/grid-generic-mono.png'), width: 420 },
  ], 'Default: proportional fallback font — the header box\'s right border lands at a different x on every row and `iiiiiiiiii|` vs `MMMMMMMMMM|` do not align, so a column claim read off these pixels would be wrong. With a monospace family the box is intact. In both, freeze drops reverse video (SGR 7) and background colour (SGR 44) that the .ans does carry.'), 'fig5-freeze-fidelity.png');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
