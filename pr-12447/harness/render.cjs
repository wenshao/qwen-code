// Render ANSI transcripts to PNG with real xterm.js in headless chromium.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const NM = '/root/verify/pr12447/node_modules';
const xtermJs = fs.readFileSync(path.join(NM, '@xterm/xterm/lib/xterm.js'), 'utf8');
const xtermCss = fs.readFileSync(path.join(NM, '@xterm/xterm/css/xterm.css'), 'utf8');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const figs = [
  ['fig1-pr-gates', 'PR #12447 @ b1ff554 — the PR\'s own gates, executed locally (TS 24/24, Java 29/29, build / typecheck / eslint / bundle)', 150],
  ['fig2-probe', 'Black-box raw-TCP probe @ b1ff554: 41/44 conform; the 3 compressed-body error pages become JSON 400 with inflate: false', 150],
  ['fig3-jdk-replay', 'Real JDK 21 HttpClient consumer replaying the shared fixtures against the TypeScript contract', 130],
  ['fig4-mutants', 'Mutation sweep @ b1ff554: the PR suite kills 17/43 mutants; with the suggested additions 39/43', 120],
  ['fig5-java-drift', 'Java ManagedRuntimeAttestationConformanceTest vs 8 drifted fixture files', 140],
];
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const [name, title, cols] of figs) {
    let data = fs.readFileSync(`${name}.ansi`, 'utf8').replace(/\x1b\[[0-9;]*[GKJ]/g, '');
    const rows = data.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.replace(/\x1b\[[0-9;]*m/g, '').length / cols)), 0) + 3;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1000 } });
    await page.setContent(`<!doctype html><html><head><style>${xtermCss}
      body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,sans-serif}
      .wrap{padding:18px 20px 14px;background:#0d1117;display:block;width:fit-content}
      .title{color:#e6edf3;font-size:15px;font-weight:600;margin:0 0 10px 2px}
      .xterm .xterm-viewport{overflow:hidden!important}
    </style></head><body><div class="wrap"><div class="title">${esc(title)}</div><div id="t"></div></div>
      <script>${xtermJs}</script></body></html>`);
    await page.evaluate(({ data, rows, cols }) => new Promise((resolve) => {
      const term = new Terminal({ cols, rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace',
        theme: { background: '#0d1117', foreground: '#d0d7de', green: '#3fb950', red: '#f85149', yellow: '#d29922', cyan: '#39c5cf', brightBlack: '#6e7681' } });
      term.open(document.getElementById('t'));
      term.write(data + '\x1b[?25l', resolve);
    }), { data, rows, cols });
    await page.waitForTimeout(300);
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    box = await page.locator('.wrap').boundingBox();
    await page.screenshot({ path: `${name}.png`, clip: box });
    await page.close();
    console.log(name, Math.round(box.width), 'x', Math.round(box.height), 'rows', rows);
  }
  await browser.close();
})();
