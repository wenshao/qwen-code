// Renders the #13431 evidence cards from the rig result files.
// node gen-figs.mjs <results dir> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [resultsDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const require = createRequire('/Users/wenshao/git/qwen-code/package.json');
const { chromium } = require('playwright');
const read = (p) => fs.readFileSync(path.join(resultsDir, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

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
  ['workspace-tool-turn', 'workspace-tool-turn (fixed by #13419; control)'],
];
const ka = (r) =>
  Object.entries(r.keepAliveSeen)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="${k === 'timeout=60' ? 'bad' : 'good'}">${k === 'null' ? '(none)' : k} ×${v}</span>`)
    .join('<br>');
const idleClose = (r) => {
  const parts = [];
  if (r.serverCloseIdleMedianMs != null)
    parts.push(`proxy closed ×${r.closedBy.server ?? 0} (median idle ${r.serverCloseIdleMedianMs} ms)`);
  if (r.clientCloseIdleMedianMs != null)
    parts.push(`client retired ×${r.closedBy.client ?? 0} (median idle ${r.clientCloseIdleMedianMs} ms)`);
  return parts.join('<br>') || '<span class="dim">—</span>';
};
const hintCls = () => '';

// Figure 1: natural runs, wire view.
{
  const base = json('base-probe/probe/summary.json');
  const head = json('head-probe/probe/summary.json');
  let rows = '';
  for (const [key, label] of drivers) {
    const b = base[key];
    const h = head[key];
    rows += `<tr><td class="mono">${esc(label)}</td><td class="num">${b.storeResponses}</td><td class="mono ${hintCls(b)}">${ka(b)}</td><td class="mono">${idleClose(b)}</td><td class="num">${h.storeResponses}</td><td class="mono ${hintCls(h)}">${ka(h)}</td><td class="mono">${idleClose(h)}</td><td class="num">${b.storeErrors.length} / ${h.storeErrors.length}</td></tr>`;
  }
  const html = page(
    '#13431 — what the daemon’s fetch pool received from each Store relay',
    'Full <code>-Phosted-harness-mysql</code> profile on Linux arm64 (.54), MySQL 8.4.11, Java 21.0.9, Node 22.22.2. base = dd82140b, head = ce767d93; the trees differ only in the 8 PR files and share one <code>dist/</code>. A passive probe on undici’s diagnostics channels inside every daemon recorded each Store reply’s <code>Keep-Alive</code> hint and who closed each idle socket.',
    `<table><tr><th rowspan="2">driver (Store relay)</th><th colspan="3">base</th><th colspan="3">head</th><th rowspan="2">Store transport errors<br>base / head</th></tr>
<tr><th>Store replies</th><th>Keep-Alive hint seen</th><th>Store sockets closed by<br>(median idle at close)</th><th>Store replies</th><th>Keep-Alive hint seen</th><th>Store sockets closed by<br>(median idle at close)</th></tr>${rows}</table>
<div class="note">On base the four sibling relays forward Spring’s <code>timeout=60</code>, so the pool treats sockets as reusable well past the moment the Node proxy closes them at ~6.0 s idle (latency: median 6002 ms; the lag probe in the next figure catches a reuse at 6.4 s). On head every relay advertises the proxy’s own <code>timeout=5</code> and the pool retires idle sockets itself at ~3.0 s, matching the #13419 workspace relay. Proxy-side closes well under 5 s idle (44–1034 ms) are the drivers’ injected disconnects, and the transport errors are those same faults (at 37–1033 ms idle or on fresh sockets): the counts are the same on both arms. The few <code>timeout=5</code> replies on base are relayed Store replies that carried no upstream <code>Keep-Alive</code> (mostly the 500s of the injected commit faults), so the proxy’s own hint shows through.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '01-wire-natural.html'), html);
}

// Figure 2: lag probe.
{
  const base = json('base-lag/probe/summary.json');
  const head = json('head-lag/probe/summary.json');
  let rows = '';
  for (const [key, label] of drivers) {
    const b = base[key];
    const h = head[key];
    const stale = (r) => (r.reuseIdleOver5s ? `<span class="bad">${r.reuseIdleOver5s} (max ${r.reuseIdleMaxMs} ms)</span>` : `<span class="good">0</span> <span class="dim">(max ${r.reuseIdleMaxMs} ms)</span>`);
    rows += `<tr><td class="mono">${esc(label)}</td><td class="num">${b.lagInjections}</td><td class="mono">${stale(b)}</td><td class="num">${h.lagInjections}</td><td class="mono">${stale(h)}</td></tr>`;
  }
  const timeline = (file) => {
    const byDaemon = new Map();
    for (const raw of read(file).split('\n')) {
      if (!raw.startsWith('process-crash')) continue;
      const l = raw.replace(/\s+/g, ' ').replace(/^process-crash /, '');
      const daemon = l.split(' ')[0].replace('.jsonl', '');
      const events = byDaemon.get(daemon) ?? [];
      const lag = /lag at t=\[([\d, ]+)\]/.exec(l);
      if (lag) {
        for (const t of lag[1].split(','))
          events.push([Number(t), `${daemon} t=${t.trim().padStart(6)} HOLD released (pool idle forced to 5.8 s, then 0.6 s block)`]);
      } else {
        const t = Number(/t= *(\d+)/.exec(l)[1]);
        const rest = l.replace(/^\S+ t= *\d+ /, '');
        events.push([t, `${daemon} t=${String(t).padStart(6)} ${rest}`]);
      }
      byDaemon.set(daemon, events);
    }
    return [...byDaemon.values()].flatMap((e) => e.sort((a, b) => a[0] - b[0]).map(([, l]) => l));
  };
  const lines = timeline('base-lag/probe/errors.txt');
  const headLines = timeline('head-lag/probe/errors.txt');
  const colour = (l) =>
    esc(l)
      .replace(/(REUSE[^\n]*idle=\d{4,})/, '<span class="warn">$1</span>')
      .replace(/(ERROR sock=\d+ idle=6\d{3}[^\n]*)/, '<span class="bad">$1</span>')
      .replace(/(HOLD released[^\n]*)/, '<span class="dim">$1</span>');
  const html = page(
    '#13431 — lag probe: a sibling relay hands the daemon a socket the proxy already closed',
    'Same rig, five driver ITs. The probe (generic form of the #13419 lag probe, identical on both arms) holds a Store request that follows ≥1 s of idleness until the pool has been idle 5.8 s, then blocks the event loop 0.6 s, so the proxy’s ~6.0 s idle close lands inside the stall.',
    `<table><tr><th rowspan="2">driver</th><th colspan="2">base (dd82140b)</th><th colspan="2">head (ce767d93)</th></tr><tr><th>holds</th><th>Store sockets reused after &gt; 5 s idle</th><th>holds</th><th>Store sockets reused after &gt; 5 s idle</th></tr>${rows}</table>
<h2>base, process-crash daemons — probe events around the hold</h2><pre>${lines.map(colour).join('\n')}</pre>
<h2>head, process-crash daemons — same probe</h2><pre>${headLines.map(colour).join('\n')}</pre>
<div class="note">Base: right after the hold, the pool reuses sockets idle 6401–6456 ms that the proxy closed at ~6.0 s, and <code>transactions:commit</code> / <code>writers:renew</code> fail with <code>UND_ERR_SOCKET other side closed</code> — the #13419 failure mode, now through one of the four sibling relays (the PR had reproduced it only through the workspace relay). Head: no process-crash Store socket is reused after more than 979 ms idle; its remaining errors are on fresh sockets or at &lt;1 s idle, as in the natural runs (injected faults). shell-output and latency never idled ≥1 s on the Store path, so the probe never held them. IT verdicts under this probe are not a signal: it stretches every scenario, store-failure and process-crash fail on both arms with <code>409 managed_session_writer_conflict</code>, and the workspace method (natural 236–238 s on every arm) finished at 273.0 s on base and hit its 270 s driver timeout on head after one extra hold, with zero Store errors on either arm.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '02-lag-probe.html'), html);
}

// Figure 3: CI-equivalent lane.
{
  const runs = [
    ['merge-pristine', 'head ⊕ main 9cdb0f38 (no probe)'],
    ['base-probe', 'base dd82140b (passive probe)'],
    ['head-probe', 'head ce767d93 (passive probe)'],
  ];
  const classes = [
    'HostedWorkspaceToolTurnIT',
    'HostedProcessCrashIT',
    'HostedHarnessMySqlIT',
    'HostedConcurrentTurnBurstMySqlIT',
    'HostedWorkspaceRecoveryWorkerIT',
    'HostedWorkspaceStorageGuardMySqlIT',
    'HostedPublicWorkspaceIT',
    'HostedWorkspaceConcurrencyIT',
  ];
  const cell = (run, cls) => {
    const dir = path.join(resultsDir, run, 'failsafe-reports');
    const f = fs.readdirSync(dir).find((n) => n.endsWith(`.${cls}.txt`));
    if (!f) return '<td class="dim">—</td>';
    const m = /Tests run: (\d+), Failures: (\d+), Errors: (\d+)/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bad = Number(m[2]) + Number(m[3]);
    const total = Number(m[1]);
    return `<td class="num ${bad ? 'bad' : 'good'}">${total - bad}/${total}</td>`;
  };
  const steps = (run) => {
    const s = read(`${run}/steps.txt`);
    const get = (n) => /STEP (\S+) rc=(\d+) secs=(\d+)/g;
    void get;
    const out = {};
    for (const m of s.matchAll(/STEP (\S+) rc=(\d+) secs=(\d+)/g)) out[m[1]] = [Number(m[2]), Number(m[3])];
    return out;
  };
  let head = '<tr><th>step / IT class</th>' + runs.map(([, l]) => `<th>${esc(l)}</th>`).join('') + '</tr>';
  let rows = '';
  const st = runs.map(([r]) => steps(r));
  const stepRow = (name, label) => {
    rows += `<tr><td class="mono">${esc(label)}</td>${st.map((s) => (s[name] ? `<td class="${s[name][0] ? 'bad' : 'good'}">rc=${s[name][0]} (${s[name][1]} s)</td>` : '<td class="dim">n/a</td>')).join('')}</tr>`;
  };
  stepRow('relay-test', 'Check Hosted proxy header relay (new step)');
  for (const cls of classes)
    rows += `<tr><td class="mono">${cls}${['HostedWorkspaceToolTurnIT', 'HostedProcessCrashIT'].includes(cls) ? ' <span class="warn">← runs the 5 drivers</span>' : ''}</td>${runs.map(([r]) => cell(r, cls)).join('')}</tr>`;
  stepRow('failsafe-check', 'check-failsafe-reports.js hosted');
  stepRow('latency', 'hosted-latency-baseline.test.ts');
  const html = page(
    '#13431 — CI lane replay (Hosted process fault gates) on Linux',
    'Every step of the <code>hosted-harness-mysql</code> job that touches the PR files, on .54 (aarch64, 8 cores), container with JDK 21.0.9 / Maven 3.9.11 / Node 22.22.2, MySQL 8.4.11 container. Unit stage: 1020 tests, 0 failures in each run.',
    `<table>${head}${rows}</table>
<div class="note">Both ITs that launch the five drivers pass on all three trees, and the new relay step passes (22/22). The red cells are in classes that launch no driver. <code>HostedWorkspaceConcurrencyIT</code> fails its own cleanup on a <code>managed_agent_snapshot</code> foreign key on every arm when it runs last, as it does here; CI runs it second and it is green there, and alone on the merge tree it passes 2/2. <code>HostedPublicWorkspaceIT</code> failed 2/5 once on the merge tree (<code>Managed Runtime process is not alive</code>), passed 4/4 on base and head and 5/5 alone on the merge tree; a second solo run, made while another session's build pushed host load to 40–54, timed out one durable-close case at 150 s. The author reports both classes as local-only.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '03-ci-lane.html'), html);
}

// Figure 4: mutation matrix.
{
  const m = json('mutants/matrix.json').filter((r) => 'killed' in r).map((r) => ({ ...r, id: r.id.replace(' (equivalent?)', ' (equivalent)') }));
  const group = (prefix) => m.filter((r) => r.id.startsWith(prefix));
  const short = (t) =>
    t
      .replace('keeps only the end-to-end headers that describe the buffered body', 'case 1')
      .replace("advertises the proxy's own keep-alive window, not the upstream's", 'case 2')
      .replace('routes every wholesale upstream-header relay through relayedHeaders', 'case 3 (AST scan)')
      .replace('keeps the five store relays calling the shared helper', 'case 4 (caller pin)');
  const table = (rows) =>
    `<table><tr><th>mutant</th><th>result</th><th>failing cases</th></tr>${rows
      .map(
        (r) =>
          `<tr><td class="mono">${esc(r.id)}</td><td class="${r.killed ? 'good' : r.id.includes('equivalent') ? 'dim' : 'bad'}">${r.killed ? 'killed' : r.id.includes('equivalent') ? 'survives (equivalent)' : 'survives'}</td><td class="mono">${esc(r.failed.map(short).join(', ')) || '—'}</td></tr>`,
      )
      .join('')}</table>`;
  const killed = m.filter((r) => r.killed).length;
  const equivalent = m.filter((r) => r.id.includes('equivalent')).length;
  const html = page(
    `#13431 — independent mutation matrix: ${killed} / ${m.length - equivalent} non-equivalent mutants killed`,
    'Each mutant is one exact replacement (or a new file) in the head tree; the file’s 22 tests are run with the CI command (<code>cd integration-tests && npx vitest run helpers/hosted-relay-headers.test.ts</code>), then the tree is restored and checked clean. Unmutated baseline 22/22 before and after.',
    `<div style="display:flex;gap:24px;align-items:flex-start"><div><h2>relayedHeaders itself</h2>${table(group('F-'))}</div><div><h2>driver call sites</h2>${table(group('D-'))}<h2>drivers added later</h2>${table(group('N-'))}</div></div>
<div class="note">Every non-equivalent mutant of the filter and every per-driver revert is killed (dropping <code>.filter(Boolean)</code> only adds an empty name to the drop set). The three survivors are scope limits of the case-3 scan, not of the filter: a header literal may name <code>keep-alive</code> explicitly; <code>const</code> bindings are matched by name, not scope, so a <code>let</code> that shadows a safe <code>const</code> name passes; and only files named <code>hosted-*-driver.ts</code> are scanned, so a relay moved into a shared helper module would not be. The bound-alias mutant dies only because it also removes the helper call; the scan does not inspect an aliased <code>writeHead</code>. Separately, deleting the new workflow step leaves all 41 workflow pin tests green.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '04-mutants.html'), html);
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const name of fs.readdirSync(outDir).filter((n) => n.endsWith('.html')).sort()) {
  const p = await context.newPage();
  await p.goto('file://' + path.join(outDir, name));
  const clipped = await p.evaluate(() =>
    [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 80)),
  );
  if (clipped.length) console.log(name, 'CLIPPED:', clipped);
  await p.locator('#card').screenshot({ path: path.join(outDir, name.replace('.html', '.png')) });
  console.log('rendered', name);
  await p.close();
}
await browser.close();
