// Render harness transcripts (real ANSI) through xterm.js into PNGs, one fresh page per figure.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/root/verify/pr13250/head/node_modules/playwright-core');

const NM = '/root/verify/pr13250/head/node_modules/@xterm/xterm';
const XTERM_JS = fs.readFileSync(path.join(NM, 'lib/xterm.js'), 'utf8');
const XTERM_CSS = fs.readFileSync(path.join(NM, 'css/xterm.css'), 'utf8');
const RUNS = path.join(__dirname, 'runs');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const COLS = 128;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const visibleLen = (l) => [...l.replace(/\x1b\[[0-9;]*m/g, '')].length;
function rowsFor(text) {
  return text.split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(visibleLen(l) / COLS)), 0) + 2;
}
function transcript(dir) {
  const lines = fs.readFileSync(path.join(RUNS, dir, 'transcript.ansi'), 'utf8').replace(/\x1b\[[0-9;]*[GKJ]/g, '').trimEnd().split('\n');
  // Stable sort by the leading time column: sends are stamped with their real ledger time.
  const t = (l) => Number((/^\s*([\d.]+)s/.exec(l.replace(/\x1b\[[0-9;]*m/g, '')) || [0, 0])[1]);
  return lines.map((l, i) => [t(l), i, l]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]).join('\n');
}

async function figure(browser, file, title, subtitle, panes) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  const paneHtml = panes
    .map((p, i) => `<div class="pane"><div class="ph"><span class="tag ${p.kind}">${esc(p.label)}</span> ${esc(p.caption)}</div><div class="term" id="t${i}"></div></div>`)
    .join('');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${XTERM_CSS}
    body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
    .wrap{padding:22px 24px 18px;width:max-content}
    h1{font-size:19px;margin:0 0 4px;font-weight:600}
    .sub{color:#8b949e;font-size:13px;margin:0 0 16px;max-width:1080px;line-height:1.45}
    .pane{margin:0 0 16px;border:1px solid #30363d;border-radius:8px;overflow:hidden;background:#0d1117}
    .ph{background:#161b22;border-bottom:1px solid #30363d;padding:8px 12px;font-size:13px;color:#c9d1d9}
    .tag{display:inline-block;padding:1px 8px;border-radius:10px;font-weight:600;font-size:12px;margin-right:6px}
    .tag.base{background:#3d1d20;color:#ffa198}.tag.head{background:#12361f;color:#7ee787}.tag.neutral{background:#1f2a3d;color:#79c0ff}
    .term{padding:8px 10px;display:block}
    .xterm .xterm-viewport{overflow:hidden!important}
  </style></head><body><div class="wrap"><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>${paneHtml}</div>
  <script>${XTERM_JS}</script></body></html>`);
  await page.evaluate(
    async (ps) => {
      const theme = { background: '#0d1117', foreground: '#d0d7de', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681' };
      await Promise.all(
        ps.map(
          (p, i) =>
            new Promise((res) => {
              const term = new window.Terminal({ cols: p.cols, rows: p.rows, convertEol: true, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, Menlo, monospace', theme, cursorBlink: false });
              term.open(document.getElementById('t' + i));
              term.write(p.text + '\x1b[?25l', res);
            }),
        ),
      );
    },
    panes.map((p) => ({ text: p.text, rows: rowsFor(p.text), cols: COLS })),
  );
  await page.waitForTimeout(300);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  const box2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: path.join(OUT, file), clip: { x: box2.x, y: box2.y, width: Math.ceil(box2.width), height: Math.ceil(box2.height) } });
  await page.close();
  console.log('wrote', file);
}

async function tableFigure(browser, file, html) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
    .wrap{padding:22px 24px 18px;width:max-content;max-width:1240px}
    h1{font-size:19px;margin:0 0 4px;font-weight:600} h2{font-size:15px;margin:18px 0 8px;font-weight:600}
    .sub{color:#8b949e;font-size:13px;margin:0 0 14px;line-height:1.45}
    table{border-collapse:collapse;font-size:12.5px} td,th{border:1px solid #30363d;padding:4px 9px;text-align:left;vertical-align:top}
    th{background:#161b22;color:#c9d1d9;font-weight:600} td.n{text-align:right;font-variant-numeric:tabular-nums}
    .k{color:#3fb950;font-weight:600}.s{color:#d29922;font-weight:600}.f{color:#ff7b72;font-weight:600}.p{color:#3fb950}
    code{font-family:DejaVu Sans Mono,Menlo,monospace;font-size:12px;color:#d2a8ff}
  </style></head><body><div class="wrap">${html}</div></body></html>`);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  const box2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: path.join(OUT, file), clip: { x: box2.x, y: box2.y, width: Math.ceil(box2.width), height: Math.ceil(box2.height) } });
  await page.close();
  console.log('wrote', file);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const HEAD = 'head 45bebb73';
  const BASE = 'base 1a933f7b';
  await figure(browser, '01-isolation-linux.png', 'S1 · Zero-config groupAllPolicy "all" — qwen channel start qq (Linux)',
    'Real CLI from each worktree\'s dist, fake QQ Open Platform over real TLS/WSS, recording model that answers from the history it is handed. XFAIL = the known base defect, encoded as an expected failure.',
    [
      { kind: 'base', label: BASE, caption: 'main at the PR\'s merge-base', text: transcript('s1-isolation-base') },
      { kind: 'head', label: HEAD, caption: 'PR head', text: transcript('s1-isolation-head') },
    ]);
  await figure(browser, '02-media-shared-context.png', 'S2 · Inbound media (#12850) under the new thread scope',
    'Phase A: an image sent by U1 lands in group GA\'s shared session (U2\'s turn sees the attachment file), not in GB or the DM. Phase B: an image turn arrives while U2\'s turn is still streaming in the same group; each reply keeps its own msg_id.',
    [
      { kind: 'base', label: BASE, caption: 'image stays in U1\'s per-sender session', text: transcript('s2-media-base') },
      { kind: 'head', label: HEAD, caption: 'image is group context; queued turn keeps its anchor', text: transcript('s2-media-head') },
    ]);
  await figure(browser, '03-media-steer-boundary.png', 'S3 · An operator\'s image message steers another member\'s streaming turn',
    'Both arms run with an explicit sessionScope "thread" + operators ["U1"], so only the PR\'s seal/cancel boundary machinery differs. U2 streams SLOW:8; U1 sends an image at +2.5 s.',
    [
      { kind: 'base', label: BASE, caption: 'cancelled partial merged into the image reply, anchored to m-img2', text: transcript('s3-media-steer-base') },
      { kind: 'head', label: HEAD, caption: 'partial flushed on its own anchor m-s1, then the image reply on m-img2', text: transcript('s3-media-steer-head') },
    ]);
  await figure(browser, '04-daemon-mode.png', 'S4 · Daemon-managed worker — qwen serve --channel qq',
    'Not executed in the previous round. Same zero-config cells as S1, routed through daemon-worker.ts; routing keys read from the daemon\'s channels/daemon/<id>/routes.json.',
    [
      { kind: 'base', label: BASE, caption: 'per-sender fragmentation, DM treated as shared', text: transcript('s4-daemon-base') },
      { kind: 'head', label: HEAD, caption: 'per-group shared sessions, DM per-user', text: transcript('s4-daemon-head') },
    ]);
  await figure(browser, '05-operators-gating.png', 'S5 · A tool call that needs approval in an untouched (no operators) QQ group',
    'Plain @mention deployment, no sessionScope, no operators, no approvalMode. The model asks to run `touch`; the requester answers /approve.',
    [
      { kind: 'base', label: BASE, caption: 'requester approves; tool runs; group keeps working', text: transcript('s5-operators-base-zero') },
      { kind: 'head', label: HEAD, caption: 'nobody can approve; the group is blocked until the 300 s ACP permission timeout', text: transcript('s5b-wedge-head') },
      { kind: 'head', label: HEAD + ' + operators ["U1"]', caption: 'the documented remedy restores approval', text: transcript('s5-operators-head-ops') },
    ]);

  // mutation matrix + witnesses
  const matrix = JSON.parse(fs.readFileSync(path.join(RUNS, 'mutation', 'matrix.json'), 'utf8'));
  const wit = JSON.parse(fs.readFileSync(path.join(RUNS, 'witness', 'witness.json'), 'utf8'));
  const killed = matrix.filter((r) => r.id !== 'm00' && r.killed).length;
  const total = matrix.filter((r) => r.id !== 'm00').length;
  const rows = matrix
    .map((r) => `<tr><td><code>${r.id}</code></td><td>${esc(r.gate)}</td><td class="n">${r.failed}/${r.tests}</td><td class="${r.id === 'm00' ? 'p' : r.killed ? 'k' : 's'}">${r.id === 'm00' ? 'control: clean' : r.killed ? 'KILLED' : 'SURVIVED'}</td><td>${esc(r.files.join(', '))}</td></tr>`)
    .join('');
  const targets = ['m00', 'm06', 'm07', 'm09', 'm12'];
  const ws = ['W06', 'W07', 'W09', 'W12'];
  const wrows = ws
    .map((w) => `<tr><td><code>${w}</code></td>${targets.map((t) => { const x = wit.find((e) => e.target === t && e.witness === w); const ok = x && x.status === 'passed'; return `<td class="${ok ? 'p' : 'f'}">${ok ? 'pass' : 'FAIL'}</td>`; }).join('')}</tr>`)
    .join('');
  await tableFigure(browser, '06-mutation-matrix.png', `
    <h1>Targeted mutation matrix over the PR's gates — qqbot suite (540 tests), head 45bebb73</h1>
    <p class="sub">One minimal edit per mutant in <code>QQChannel.ts</code> / <code>index.ts</code>, run in <code>src/__mut__/&lt;id&gt;/</code> beside an unmutated control. ${killed}/${total} killed; control 0 failures; directory removed and <code>git status</code> clean afterwards.</p>
    <table><tr><th>id</th><th>gate removed / inverted</th><th>failed</th><th>verdict</th><th>killing files</th></tr>${rows}</table>
    <h2>Survivors are real, not equivalent: one witness test each (passes on head, fails only on its own mutant)</h2>
    <table><tr><th>witness</th>${targets.map((t) => `<th><code>${t}</code>${t === 'm00' ? ' (head)' : ''}</th>`).join('')}</tr>${wrows}</table>`);
  await browser.close();
})();
