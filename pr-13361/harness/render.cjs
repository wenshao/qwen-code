// Renders the PR #13361 verification figures to PNG (local only).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const css = `
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{padding:22px 26px;display:inline-block}
h1{font-size:19px;margin:0 0 4px} .sub{color:#8b949e;margin:0 0 14px;font-size:13px}
h2{font-size:15px;margin:18px 0 8px;color:#c9d1d9}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:6px 9px;vertical-align:top;text-align:left}
th{background:#161b22;color:#c9d1d9;font-weight:600}
td.k{color:#c9d1d9;max-width:300px} td.s{color:#8b949e;white-space:nowrap}
.r{background:#3d1214;color:#ffa198} .g{background:#0f2e1a;color:#7ee787} .n{color:#6e7681;text-align:center}
.y{background:#332701;color:#e3b341}
code{font-family:"DejaVu Sans Mono",Menlo,monospace;font-size:12px}
.pane{border:1px solid #30363d;border-radius:6px;margin:0 0 14px;width:1180px}
.cap{background:#161b22;border-bottom:1px solid #30363d;padding:7px 12px;font-weight:600;font-size:13px}
.cap span{font-weight:400;color:#8b949e}
pre{margin:0;padding:10px 12px;font:12px/1.5 "DejaVu Sans Mono",Menlo,monospace;white-space:pre-wrap;word-break:break-all;color:#c9d1d9}
.hl{color:#ffa198;font-weight:600} .ok{color:#7ee787;font-weight:600} .tag{color:#e3b341;font-weight:600} .dim{color:#8b949e}
.foot{color:#8b949e;font-size:12px;margin-top:10px;max-width:1180px}
`;

function cell(v) {
  if (v === '-') return '<td class="n">–</td>';
  const cls = v.startsWith('200') ? 'g' : v.startsWith('!') ? 'y' : 'r';
  return `<td class="${cls}">${esc(v.replace(/^!/, ''))}</td>`;
}

function matrixHtml() {
  const head =
    '<tr><th>Injected at cold load #2 (the CI-failing load)</th><th>Knob</th><th>A · main 9915c7f<br><span class="dim">PR base</span></th><th>T · A + PR tags<br><span class="dim">no retry</span></th><th>M · PR head,<br><span class="dim">retry forced off</span></th><th>H · PR head<br><span class="dim">1dcda71</span></th></tr>';
  const stall = [
    ['Event-loop stall before the first read of verifyWorkspaceRestore\'s burst', '6 s', '409 · 3/3 · stderr silent', '409 · 3/3 · tag workspace_verify', '409 · 2/2 · tag + endpoint', '200 · 3/3 (1 fetch rejected, retried)'],
    ['Event-loop stall before an open-phase read', '6 s', '503 open_failed · 2/2', '503 open_failed · 1/1', '-', '200 · 2/2'],
    ['Same stall, below the proxy\'s 5 s keep-alive (control)', '3 s', '200 · 1/1 · 0 rejected', '200 · 1/1 · 0 rejected', '-', '200 · 1/1 · 0 rejected'],
    ['Longer stall', '12 s', '-', '-', '-', '200 · 1/1'],
    ['Event-loop stall before the activation commit', '6 s', '!200 · 1/1 (pre-existing commit retry)', '-', '-', '!200 · 1/1 (same)'],
    ['Burst stall with proxy keepAliveTimeout = 65 s', '6 s', '200 · 2/2 · 0 rejected', '-', '-', '-'],
  ];
  const faults = [
    ['GET /restore? connection reset once', 'proxy', '503 open_failed · 1 req', '-', '503 open_failed · 1 req', '200 · 2 req'],
    ['GET /transactions? 503 twice', 'proxy', '503 open_failed · 1 req', '-', '-', '200 · 3 req'],
    ['GET /resources/<id> body cut mid-stream once', 'proxy', '503 · raw "TypeError: terminated"', '-', '503 · 1 req', '200 · +1 read'],
    ['GET /resources/<id> 502 twice', 'proxy', '503 open_failed · 1 req', '-', '-', '200 · +2 reads'],
    ['POST /writers:renew applied, reply lost', 'proxy', '409 · stderr silent', '409 · tag workspace_writable', '409 · tag workspace_writable', '200 · Store accepted the repeat renew'],
    ['POST /transactions:commit applied, reply lost', 'proxy', '!200 · same as H', '-', '-', '!200 · same as A'],
    ['GET /resources/<id> 404 every time', 'proxy', '!refused · 1 req', '-', '-', '!refused · 1 req (not retried)'],
    ['GET /resources/<id> 503 every time (open phase)', 'proxy', '!refused · 1 req · 60 ms', '-', '-', '!refused · 3 req · 751 ms'],
    ['GET /resources/<id> 503 every time, verify burst only', 'proxy', '!refused · 26 req · 89 ms', '-', '-', '!refused · 78 req · 857 ms, tagged'],
    ['GET /restore? never answers', 'proxy', '!refused · 30.04 s · 1 req', '-', '-', '!refused · 30.03 s · 1 req'],
    ['Real damaged seal (Store 500 managed_session_resource_corrupt)', 'IT step', '!409 · corrupt resource read 1×', '-', '-', '!409 · read 3× ("failed after 3 attempts")'],
  ];
  const rows = (list) =>
    list.map((r) => `<tr><td class="k">${esc(r[0])}</td><td class="s">${esc(r[1])}</td>${r.slice(2).map(cell).join('')}</tr>`).join('');
  return `<div class="wrap"><h1>PR #13361 — real Hosted topology A/B (HostedWorkspaceToolTurnIT, MySQL 8.4, Linux)</h1>
<p class="sub">Spring Session Store + embedded Runtime Broker + bundled worker, driven by the CI lane's own IT. Every cell is the armed cold load's outcome (driver javaLoad), with run count. 55 IT runs in total.</p>
<h2>1 · Deterministic event-loop stall in the daemon (stand-in for a starved runner)</h2>
<table>${head}${rows(stall)}</table>
<h2>2 · Faults injected in the driver's Store proxy, same cold load</h2>
<table>${head}${rows(faults)}</table>
<p class="foot">Red = load fails (409 is the #13255 assertion; 503 open_failed is the daemon's generic open failure, which the IT sees as HTTP 500). Green = load succeeds and the IT continues green. Amber = same outcome on both arms, by design.<br>
Rejected-fetch cause in every stall row that failed: <code>TypeError: fetch failed ← SocketError: other side closed (UND_ERR_SOCKET)</code>. The driver's Store proxy is a Node http.Server with the default 5 s keepAliveTimeout.<br>
Not shown: 2 un-injected occurrences of the same rejection hit H during cold loads outside the armed window; both loads still answered 200, and neither was preceded by the daemon's "event loop stall detected" warning.</p></div>`;
}

function panesHtml() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'panes.json'), 'utf8'));
  const color = (l) => {
    let s = esc(l);
    if (/load refused/.test(l)) return `<span class="tag">${s}</span>`;
    if (/409 !== 200|AssertionError|status=409/.test(l)) return `<span class="hl">${s}</span>`;
    if (/HTTP 200|Failures: 0/.test(l)) return `<span class="ok">${s}</span>`;
    if (/stall detected|probe:|store proxy:|cause:/.test(l)) return `<span class="dim">${s}</span>`;
    return s;
  };
  const pane = (title, sub, lines) =>
    `<div class="pane"><div class="cap">${esc(title)} <span>${esc(sub)}</span></div><pre>${lines.map(color).join('\n')}</pre></div>`;
  return `<div class="wrap"><h1>Same 6 s stall, same cold load, three builds</h1>
<p class="sub">Daemon output as the driver retained it in the failsafe JUnit report (A, M), and the probe/proxy timeline for H. Driver line numbers are shifted by the env-gated local hooks (:593/:595 here = :513 upstream).</p>
${pane('A · main 9915c7f', '— the #13255 assertion: the refused SHELL_REFUSAL turn, then 409 at javaLoad; nothing names the gate', d.A)}
${pane('M · PR head with the retry forced off', '— same 409, but the retained output now names the gate, the endpoint and the cause', d.M)}
${pane('H · PR head 1dcda71', '— the same rejected fetch is retried 278 ms later and the load answers 200; the IT stays green', d.H)}
</div>`;
}

(async () => {
  const exe = '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });
  for (const [name, body] of [['fig1-matrix', matrixHtml()], ['fig2-retained-output', panesHtml()]]) {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
    const box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    const box2 = await page.locator('.wrap').boundingBox();
    await page.screenshot({ path: path.join(__dirname, `${name}.png`), clip: box2 });
    await page.close();
    console.log('wrote', name, Math.round(box2.width), 'x', Math.round(box2.height));
  }
  await browser.close();
})();
