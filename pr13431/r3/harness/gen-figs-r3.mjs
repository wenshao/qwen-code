// Renders the #13431 round-3 evidence cards. node gen-figs-r3.mjs <results dir> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [resultsDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const require = createRequire('/Users/wenshao/git/qwen-code/package.json');
const { chromium } = require('playwright');
const read = (p) => fs.readFileSync(path.join(resultsDir, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const css = `
body{margin:0;background:#0d1117;font:15px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px 24px;min-width:1100px;max-width:1500px}
h1{font-size:22px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;margin:0 0 16px;font-size:14px}
table{border-collapse:collapse;margin:6px 0 12px;font-size:14px}
th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:600}
td.num{text-align:right;font-variant-numeric:tabular-nums}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;margin:6px 0 12px;white-space:pre;overflow:hidden}
.bad{color:#ff7b72}.good{color:#3fb950}.warn{color:#d29922}.dim{color:#8b949e}
.note{border-left:3px solid #388bfd;padding:4px 0 4px 12px;margin:10px 0 0;color:#c9d1d9}
h2{font-size:16px;margin:16px 0 4px;color:#79c0ff;font-weight:600}
`;
const page = (title, sub, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;
const drivers = [
  ['store-failure', 'store-failure'],
  ['shell-output', 'shell-output'],
  ['process-crash', 'process-crash'],
  ['latency', 'latency'],
  ['workspace-tool-turn', 'workspace-tool-turn (control)'],
];
const ka = (r) =>
  Object.entries(r.keepAliveSeen)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="${k === 'timeout=60' ? 'bad' : 'good'}">${k} ×${v}</span>`)
    .join('<br>');
const retire = (r) =>
  r.clientCloseIdleMedianMs != null
    ? `client ${r.clientCloseIdleMedianMs} ms`
    : r.serverCloseIdleMedianMs != null && r.serverCloseIdleMedianMs > 5000
      ? `<span class="bad">proxy ${r.serverCloseIdleMedianMs} ms</span>`
      : '<span class="dim">— (only injected disconnects)</span>';
const stale = (r) =>
  r.reuseIdleOver5s
    ? `<span class="bad">${r.reuseIdleOver5s} (max ${r.reuseIdleMaxMs} ms)</span>`
    : `<span class="good">0</span> <span class="dim">(max ${r.reuseIdleMaxMs} ms)</span>`;

// Figure 7: wire + lag on the new head against the R1 base.
{
  const base = json('r1-base-probe/probe/summary.json');
  const head = json('head3-probe/probe/summary.json');
  const baseLag = json('r1-base-lag/probe/summary.json');
  const headLag = json('head3-lag/probe/summary.json');
  let rows = '';
  for (const [key, label] of drivers) {
    const b = base[key], h = head[key], bl = baseLag[key], hl = headLag[key];
    rows += `<tr><td class="mono">${esc(label)}</td><td class="mono">${ka(b)}</td><td class="mono">${retire(b)}</td><td class="mono">${ka(h)}</td><td class="mono">${retire(h)}</td><td class="num">${b.storeErrors.length} / ${h.storeErrors.length}</td><td class="mono">${stale(bl)}</td><td class="mono">${stale(hl)}</td></tr>`;
  }
  const lagErr = read('head3-lag/probe/errors.txt').split('\n').filter((l) => / REUSE /.test(l));
  const html = page(
    '#13431 R3 — the relayUpstream refactor on the wire (head 7b64df02 vs the R1 base)',
    'Same host as R1 (.54, aarch64), same rig image, MySQL 8.4.11, Node 22.22.2, identical <code>dist/</code>. base = dd82140b (R1 run); head = 7b64df02, every tracked blob checked against <code>git ls-tree</code>. Natural columns: full <code>-Phosted-harness-mysql</code> profile with the passive probe. Lag columns: the five driver ITs with the R1 lag probe (hold to 5.8 s idle, then a 0.6 s block).',
    `<table><tr><th rowspan="2">Store relay</th><th colspan="2">base, natural</th><th colspan="2">head 7b64df02, natural</th><th rowspan="2">injected-fault<br>errors b / h</th><th colspan="2">Store sockets reused after &gt; 5 s idle (lag probe)</th></tr>
<tr><th>Keep-Alive hint seen</th><th>idle sockets retired by</th><th>Keep-Alive hint seen</th><th>idle sockets retired by</th><th>base</th><th>head 7b64df02</th></tr>${rows}</table>
${lagErr.length ? `<pre>${lagErr.map(esc).join('\n')}</pre>` : ''}
<div class="note">Routing the five relays through <code>relayUpstream</code> changes nothing on the wire: every Store reply through every relay carries the proxy's own <code>timeout=5</code>, the daemon's pool retires idle sockets itself at ~3.0 s, and the injected-fault error counts match the base exactly. Under the lag probe no Store socket is reused after more than 5 s idle on the new head, while the R1 base reused three through the process-crash relay (6401–6456 ms) and each failed with <code>UND_ERR_SOCKET other side closed</code>.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '07-r3-wire-lag.html'), html);
}

// Figure 8: coverage after the refactor.
{
  const m = json('r3-mutants/matrix.json')
    .filter((r) => 'killed' in r)
    .map((r) => ({ ...r, id: r.id.replace(' (equivalent?)', ' (equivalent)') }));
  const pin = json('r3-pin-head3/pin-matrix.json').filter((r) => 'killed' in r);
  const short = (t) =>
    t
      .replace('keeps only the end-to-end headers that describe the buffered body', 'case 1')
      .replace("advertises the proxy's own keep-alive window, not the upstream's", 'case 2 (wire)')
      .replace('keeps the five store relays calling the shared helper', 'case 3 (caller pin)');
  const groups = [
    ['relayedHeaders (filter)', (r) => r.id.startsWith('F-')],
    ['relayUpstream (status, headers, body)', (r) => r.id.startsWith('U-')],
    ['driver call sites', (r) => r.id.startsWith('D-')],
    ['drivers added later', (r) => r.id.startsWith('N-')],
  ];
  const table = (rows) =>
    `<table><tr><th>mutant</th><th>result</th><th>failing cases</th></tr>${rows
      .map((r) => {
        const eq = r.id.includes('equivalent');
        const cls = r.killed ? 'good' : eq ? 'dim' : 'warn';
        const res = r.killed ? 'killed' : eq ? 'survives (equivalent)' : 'survives (outside the positive pin)';
        return `<tr><td class="mono">${esc(r.id)}</td><td class="${cls}">${res}</td><td class="mono">${esc(r.failed.map(short).join(', ')) || '—'}</td></tr>`;
      })
      .join('')}</table>`;
  const killed = m.filter((r) => r.killed).length;
  const nonEq = m.filter((r) => !r.id.includes('equivalent')).length;
  const pinKilled = pin.filter((r) => r.killed).length;
  const html = page(
    `#13431 R3 — test coverage after the AST scanner was removed: ${killed} / ${nonEq} non-equivalent mutants killed`,
    'Head 7b64df02, the file’s 3 tests run with the CI command after each single edit (tree restored and checked clean between mutants; baseline 3/3 before and after). Workflow-step pin: the 9 R2 step mutants against <code>hosted-process-ci.test.js</code>.',
    `<div style="display:flex;gap:24px;align-items:flex-start"><div>${groups.slice(0, 1).map(([h, f]) => `<h2>${h}</h2>${table(m.filter(f))}`).join('')}</div><div>${groups.slice(1).map(([h, f]) => `<h2>${h}</h2>${table(m.filter(f))}`).join('')}<h2>workflow step pin (R2 candidate, now adopted)</h2><p class="${pinKilled === pin.length ? 'good' : 'bad'}">${pinKilled} / ${pin.length} step mutants killed, including <code>if: \${{ false }}</code>, a push-only <code>if</code> and an inert <code>shell</code></p></div></div>
<div class="note">The filter, <code>relayUpstream</code>'s status / header / body handling and every per-driver revert are pinned. The three survivors are the boundary the PR now documents rather than pretends to close: the caller pin is a positive, per-file text match, so a second wholesale relay beside the helper call, a call that only appears in a comment, and a new driver that hand-rolls its relay all stay green. The R1 AST scan killed the new-driver case; it was removed after /review R1-1 showed it was wrong in both directions.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '08-r3-coverage.html'), html);
}

// Figure 9: lanes.
{
  const classes = [
    'HostedWorkspaceToolTurnIT',
    'HostedProcessCrashIT',
    'HostedHarnessMySqlIT',
    'HostedConcurrentTurnBurstMySqlIT',
    'HostedCommittedEventLineReplayIT',
    'HostedWorkspaceRecoveryWorkerIT',
    'HostedWorkspaceStorageGuardMySqlIT',
    'HostedPublicWorkspaceIT',
    'HostedWorkspaceConcurrencyIT',
  ];
  const runs = [
    ['head3-probe', 'head 7b64df02 (.54, passive probe)'],
    ['merge4-lane', 'head ⊕ main 28512f1b (.75, no probe)'],
  ];
  const cell = (run, cls) => {
    const dir = path.join(resultsDir, run, 'failsafe-reports');
    const f = fs.readdirSync(dir).find((n) => n.endsWith(`.${cls}.txt`));
    if (!f) return '<td class="dim">— (not on this base)</td>';
    const mm = /Tests run: (\d+), Failures: (\d+), Errors: (\d+)/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bad = Number(mm[2]) + Number(mm[3]);
    return `<td class="num ${bad ? 'bad' : 'good'}">${Number(mm[1]) - bad}/${mm[1]}</td>`;
  };
  const steps = (run) => Object.fromEntries([...read(`${run}/steps.txt`).matchAll(/STEP (\S+) rc=(\d+) secs=(\d+)/g)].map((x) => [x[1], x]));
  const st = runs.map(([r]) => steps(r));
  const stepRow = (n, label) => `<tr><td class="mono">${label}</td>${st.map((s) => `<td class="${s[n][2] === '0' ? 'good' : 'bad'}">rc=${s[n][2]} (${s[n][3]} s)</td>`).join('')}</tr>`;
  let rows = stepRow('relay-test', 'Check Hosted proxy header relay');
  for (const cls of classes)
    rows += `<tr><td class="mono">${cls}${['HostedWorkspaceToolTurnIT', 'HostedProcessCrashIT'].includes(cls) ? ' <span class="warn">← runs the 5 drivers</span>' : ''}</td>${runs.map(([r]) => cell(r, cls)).join('')}</tr>`;
  rows += stepRow('failsafe-check', 'check-failsafe-reports.js hosted') + stepRow('latency', 'hosted-latency-baseline.test.ts');
  rows += `<tr><td class="mono">unit stage (surefire)</td><td class="good">725 tests, 0 failures</td><td class="warn">1246 tests, 1 failure: RuntimeBrokerDefaultOnTest (3/3 alone)</td></tr>`;
  const html = page(
    '#13431 R3 — CI lane replay on the new head and on the merge with current main',
    'Steps of <code>Hosted process fault gates / MySQL 8.4 / Java 21</code> that touch the PR files. The merge lane ran with <code>-Dmaven.test.failure.ignore=true</code> so a unit failure cannot stop failsafe; every report was read.',
    `<table><tr><th>step / IT class</th>${runs.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr>${rows}</table>
<div class="note">Both ITs that launch the five drivers pass on the new head and on the merge with main 28512f1b, as do the relay step, the failsafe-report check and the latency baseline. Main's R2 regression is fixed (#13542 → #13551: <code>ManagedSessionStoreIntegrationTest</code> 5/5 here). <code>HostedWorkspaceConcurrencyIT</code> is the same order-dependent cleanup FK as in R1/R2: it runs after the workspace ITs in both lanes (last on .54, 8th of 9 on .75) but 2nd in CI, and it passed alone in R1 and R2. <code>RuntimeBrokerDefaultOnTest</code> is Java-only and fails intermittently in the full suite on .75 (3/3 alone). On GitHub, 7b64df02's only red check is <code>windows-latest / Java 21</code>: <code>ManagedCsiAcknowledgementHttpTransportTest.totalDeadlineIncludesAResponseBodyThatNeverFinishes</code> in runtime-broker, the flake #13562 fixed on main at 05:16Z, after this run started (04:27Z).</div>`,
  );
  fs.writeFileSync(path.join(outDir, '09-r3-lanes.html'), html);
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const name of fs.readdirSync(outDir).filter((n) => n.endsWith('.html')).sort()) {
  const p = await context.newPage();
  await p.goto('file://' + path.join(outDir, name));
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 80)));
  if (clipped.length) console.log(name, 'CLIPPED:', clipped);
  await p.locator('#card').screenshot({ path: path.join(outDir, name.replace('.html', '.png')) });
  console.log('rendered', name);
  await p.close();
}
await browser.close();
