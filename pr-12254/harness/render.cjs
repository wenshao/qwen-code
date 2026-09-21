// Render ANSI transcripts (real xterm.js) and the latency chart to PNG.
// Usage: NODE_PATH=/root/verify/pr12254-head/node_modules node render.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const NM = '/root/verify/pr12254-head/node_modules';
const OUT = '/root/verify/pr12254-harness/out';
const IMG = path.join(OUT, 'imgs');
fs.mkdirSync(IMG, { recursive: true });
const XJS = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const XCSS = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

async function term(browser, name, title, ansi, cols = 170) {
  const lines = ansi.replace(/\n+$/, '').split('\n');
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil([...strip(l)].length / cols)), 0) + 3;
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1700, height: 900 } });
  await page.setContent(`<!doctype html><html><head><style>${XCSS}
    body{margin:0;background:#0d1117;font-family:-apple-system,'DejaVu Sans',sans-serif}
    .wrap{padding:18px 20px 14px;background:#0d1117;display:block;width:max-content}
    .title{color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 10px 2px}
    .title small{color:#8b949e;font-weight:400;margin-left:8px}
    #t{display:block}
  </style></head><body><div class="wrap"><div class="title">${title}</div><div id="t" style="width:${cols * 8.5 + 30}px"></div></div>
  <script>${XJS}</script></body></html>`);
  await page.evaluate(({ data, cols, rows }) => new Promise((res) => {
    const t = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: "'DejaVu Sans Mono', monospace", cursorBlink: false,
      theme: { background: '#0d1117', foreground: '#d0d7de', cursor: '#0d1117', green: '#3fb950', brightGreen: '#56d364', red: '#f85149', brightRed: '#ff7b72', yellow: '#d29922', brightYellow: '#e3b341', cyan: '#39c5cf', brightCyan: '#56d4dd', brightBlack: '#8b949e' } });
    t.open(document.getElementById('t'));
    t.write('\x1b[?25l' + data, () => setTimeout(res, 250));
  }), { data: lines.join('\n'), cols, rows });
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await page.locator('.wrap').screenshot({ path: path.join(IMG, name) });
  await page.close();
  console.log('wrote', name, `${rows} rows`);
}

function sections(ansi, pred) {
  const parts = ansi.split(/\n(?=\x1b\[1;36m━━ )/);
  return parts.filter((p) => pred(strip(p.split('\n')[0]))).join('\n');
}

async function chart(browser) {
  const perf = JSON.parse(fs.readFileSync(path.join(OUT, 'perf.json'), 'utf8'));
  const sets = [...new Set(perf.map((r) => `${r.W}x${r.N}`))];
  const BLUE = '#2a78d6';
  const ORANGE = '#eb6834';
  const panel = (key) => {
    const rows = perf.filter((r) => `${r.W}x${r.N}` === key);
    const [W, N] = key.split('x').map(Number);
    const get = (s) => rows.find((r) => r.strategy.startsWith(s));
    const groups = [
      ['organized view — what the Web Shell sidebar requests today', get('legacy organized'), get('batch organized')],
      ['default view — legacy GET reads one bounded page, batch scans the whole catalog', get('legacy default'), get('batch default')],
    ];
    const max = Math.max(...rows.map((r) => r.coldMs));
    const bar = (r, color, label) => `<div class="row"><div class="lab">${label}</div><div class="track"><div class="bar" style="width:${Math.max(0.6, (r.coldMs / max) * 100)}%;background:${color}"></div><span class="val">${r.coldMs.toLocaleString('en-US')} ms<span class="warm"> · warm ${r.warmMs} ms</span></span></div></div>`;
    return `<section><h3>${W} workspaces × ${N.toLocaleString('en-US')} sessions</h3>${groups.map(([t, l, b]) => `<div class="g"><div class="gt">${esc(t)}</div>${bar(l, BLUE, `legacy · ${l.requests} GETs`)}${bar(b, ORANGE, 'batch · 1 POST')}</div>`).join('')}</section>`;
  };
  const html = `<!doctype html><html><head><style>
    body{margin:0;background:#fcfcfb;font-family:-apple-system,'DejaVu Sans','Liberation Sans',sans-serif;color:#0b0b0b}
    .wrap{width:1040px;padding:26px 30px 22px;background:#fcfcfb}
    h2{font-size:19px;margin:0 0 4px} .sub{color:#52514e;font-size:13px;margin:0 0 14px;line-height:1.45}
    .legend{display:flex;gap:18px;font-size:13px;color:#52514e;margin:0 0 6px} .sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    section{border-top:1px solid #e6e5e1;padding:12px 0 4px} h3{font-size:14px;margin:0 0 8px}
    .g{margin:0 0 10px} .gt{font-size:12px;color:#52514e;margin:0 0 5px}
    .row{display:flex;align-items:center;margin:0 0 4px} .lab{width:128px;font-size:12px;color:#52514e;flex:none}
    .track{flex:1;display:flex;align-items:center} .bar{height:14px;border-radius:0 4px 4px 0} .val{font-size:12px;margin-left:8px;white-space:nowrap;font-variant-numeric:tabular-nums} .warm{color:#8a8983}
    .foot{color:#52514e;font-size:11.5px;margin-top:8px;line-height:1.45;border-top:1px solid #e6e5e1;padding-top:10px}
  </style></head><body><div class="wrap">
    <h2>One sidebar refresh: batch POST vs the per-workspace GETs it replaces</h2>
    <p class="sub">Cold-cache wall time, median of 7 (lower is better). Each refresh fetches every workspace's 20-row session page plus its group catalog. Bars are scaled within each panel.</p>
    <div class="legend"><span><span class="sw" style="background:${BLUE}"></span>legacy: 2 GETs per workspace, 2 in flight</span><span><span class="sw" style="background:${ORANGE}"></span>batch: 1 POST /sessions/catalog with includeGroups</span></div>
    ${sets.map(panel).join('')}
    <div class="foot">Head 021f3228 bundle, real <code>qwen serve</code> daemon on loopback, Node 22.22, Linux x64, 16 cores. "Cold" = first read after the 2 s persisted-snapshot cache expired; "warm" = the same read repeated immediately. Deterministic 3-record JSONL transcripts.</div>
  </div></body></html>`;
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 900 } });
  await page.setContent(html);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await page.locator('.wrap').screenshot({ path: path.join(IMG, 'fig4-latency.png') });
  await page.close();
  console.log('wrote fig4-latency.png');
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] });
  const e2e = fs.readFileSync(path.join(OUT, 'e2e.ansi'), 'utf8');
  const num = (h) => Number(/━━ (\d+)\./.exec(h)?.[1] ?? -1);
  await term(browser, 'fig1-e2e-catalog.png', 'PR #12254 · real daemon E2E (1/2) <small>base af4e3b29 → head 021f3228 · capability, one-request catalog, parity with the qualified GETs, continuation, selection</small>', sections(e2e, (h) => num(h) >= 1 && num(h) <= 5));
  await term(browser, 'fig2-e2e-boundaries.png', 'PR #12254 · real daemon E2E (2/2) <small>partial failure, cursor binding, base-vs-head no-regression diff, cold secondaries, removal</small>', sections(e2e, (h) => num(h) >= 6));
  const probeFiles = ['probes-live-many', 'probes-trust-rate', 'probes-cap', 'probes-sdk', 'probes-abort', 'probes-fuzz', 'probes-internal'].map((f) => path.join(OUT, f + '.ansi')).filter((f) => fs.existsSync(f));
  const probes = probeFiles.map((f) => sections(fs.readFileSync(f, 'utf8'), (h) => /━━ [A-Z]\. /.test(h))).join('\n');
  const total = probeFiles.reduce((n, f) => n + JSON.parse(fs.readFileSync(f.replace(/\.ansi$/, '.json'), 'utf8')).filter((r) => r.ok).length, 0);
  const all = probeFiles.reduce((n, f) => n + JSON.parse(fs.readFileSync(f.replace(/\.ansi$/, '.json'), 'utf8')).length, 0);
  await term(browser, 'fig3-probes.png', 'PR #12254 · extended probes on the head daemon <small>live-only paging, 21 workspaces, folder trust, rate tier, 512 KiB cap, built SDK on the wire, disconnect, hostile selectors</small>', probes + `\n\n\x1b[1;32m${total}/${all} checks passed\x1b[0m`);
  if (fs.existsSync(path.join(OUT, 'perf.json'))) await chart(browser);
  if (fs.existsSync(path.join(OUT, 'mutation.ansi'))) await term(browser, 'fig5-mutation.png', 'PR #12254 · mutation sweep <small>one production line changed per mutant, then the PR\'s own focused suites are run (207 CLI + 489 SDK tests)</small>', fs.readFileSync(path.join(OUT, 'mutation.ansi'), 'utf8'), 150);
  await browser.close();
})();
