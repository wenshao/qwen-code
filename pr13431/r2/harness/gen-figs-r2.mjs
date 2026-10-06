// Renders the #13431 round-2 evidence cards. node gen-figs-r2.mjs <results dir> <out dir>
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
.add{color:#3fb950}
`;
const page = (title, sub, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;

// Figure 5: the step pin.
{
  const arms = [
    ['r2-pin-head2/pin-matrix.json', 'head 5528a5a7'],
    ['r2-pin-head2-candidate/pin-matrix.json', 'head + candidate (+3 lines)'],
    ['r2-pin-merge3/pin-matrix.json', 'head ⊕ main ac81c07d'],
    ['r2-pin-merge3-candidate/pin-matrix.json', 'head ⊕ main + candidate'],
  ].map(([f, l]) => [json(f), l]);
  const ids = arms[0][0].filter((r) => 'killed' in r).map((r) => r.id);
  const cell = (rows, id) => {
    const r = rows.find((x) => x.id === id);
    return r.killed ? '<td class="good">killed</td>' : '<td class="bad">survives</td>';
  };
  const base = (rows) => rows.filter((r) => !('killed' in r)).map((r) => `${r.total - r.failed.length}/${r.total}`).join(' · ');
  let rows = `<tr><td class="dim">unmutated baseline (before · after)</td>${arms.map(([r]) => `<td class="mono good">${base(r)}</td>`).join('')}</tr>`;
  for (const id of ids) {
    const silent = /^if:|shell/.test(id);
    rows += `<tr><td class="mono">${esc(id)}${silent ? ' <span class="warn">← silent skip</span>' : ''}</td>${arms.map(([r]) => cell(r, id)).join('')}</tr>`;
  }
  const killed = (r) => r.filter((x) => x.killed).length;
  const patch = read('r2-candidate.patch')
    .split('\n')
    .filter((l) => /^[+ ]    expect\(job\.steps\[relay\]/.test(l) || /^@@/.test(l))
    .map((l) => (l.startsWith('+') ? `<span class="add">${esc(l)}</span>` : esc(l)))
    .join('\n');
  const html = page(
    '#13431 R2 — what the new workflow-step pin catches',
    'Each mutant edits only the <code>Check Hosted proxy header relay</code> step in <code>.github/workflows/sdk-java.yml</code>; <code>scripts/tests/hosted-process-ci.test.js</code> is run with the repo command (<code>vitest run --config ./scripts/tests/vitest.config.ts</code>), then the workflow is restored and checked clean.',
    `<table><tr><th>step mutant</th>${arms.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr>${rows}
<tr><td><b>killed</b></td>${arms.map(([r]) => `<td class="num"><b>${killed(r)} / ${ids.length}</b></td>`).join('')}</tr></table>
<h2>candidate: three more assertions, the same idiom the file already uses for the failsafe-report step (line 219)</h2><pre>${patch}</pre>
<div class="note">The pin from 5528a5a7 kills deletion, renaming, a softened command, <code>continue-on-error</code> and reordering. It does not look at <code>if</code> or <code>shell</code>, so a step that is silently skipped (<code>if: \${{ false }}</code>, or a push-only <code>if</code>) or that runs an inert shell stays green — the same class of escape the pin exists to close. <code>working-directory</code> only makes <code>cd</code> fail at run time (loud, not silent), but costs one line to pin. With the three lines, 9 / 9 are killed on head and on the merge with current main; prettier passes.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '05-r2-step-pin.html'), html);
}

// Figure 6: lane on the merge with current main + the main regression.
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
  const dir = path.join(resultsDir, 'merge3-lane', 'failsafe-reports');
  let rows = '';
  for (const cls of classes) {
    const f = fs.readdirSync(dir).find((n) => n.endsWith(`.${cls}.txt`));
    const m = /Tests run: (\d+), Failures: (\d+), Errors: (\d+)/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bad = Number(m[2]) + Number(m[3]);
    const drivers = ['HostedWorkspaceToolTurnIT', 'HostedProcessCrashIT'].includes(cls) ? ' <span class="warn">← runs the 5 drivers</span>' : cls === 'HostedCommittedEventLineReplayIT' ? ' <span class="dim">(new on main, #13355)</span>' : '';
    rows += `<tr><td class="mono">${cls}${drivers}</td><td class="num ${bad ? 'bad' : 'good'}">${Number(m[1]) - bad}/${m[1]}</td></tr>`;
  }
  const steps = read('merge3-lane/steps.txt');
  const step = (n) => /STEP (\S+) rc=(\d+) secs=(\d+)/g;
  void step;
  const st = Object.fromEntries([...steps.matchAll(/STEP (\S+) rc=(\d+) secs=(\d+)/g)].map((m) => [m[1], m]));
  const s = (n, label) => `<tr><td class="mono">${label}</td><td class="${st[n][2] === '0' ? 'good' : 'bad'}">rc=${st[n][2]} (${st[n][3]} s)</td></tr>`;
  const html = page(
    '#13431 R2 — lane replay on the merge with current main, and a main regression it exposed',
    'Trial merge b6f0e8dd = head 5528a5a7 ⊕ main ac81c07d (clean; 18 main commits since the R1 merge arm, incl. product code in <code>core/managed-runtime</code>). .75: aarch64, 12 cores, load 1–4; same rig image (JDK 21.0.9 / Maven 3.9.11), Node 22.22.2, MySQL 8.4.11.',
    `<div style="display:flex;gap:24px;align-items:flex-start"><div><table><tr><th>step / IT class</th><th>result</th></tr>${s('relay-test', 'Check Hosted proxy header relay')}${rows}${s('failsafe-check', 'check-failsafe-reports.js hosted')}${s('latency', 'hosted-latency-baseline.test.ts')}</table></div>
<div><h2>unit stage: 1039 tests, 1 error — not this PR</h2><table><tr><th>tree (packages/ identical to)</th><th><code>ManagedSessionStoreIntegrationTest</code></th></tr>
<tr><td class="mono">main ac81c07d (#13355 merged) — merge3, alone ×2</td><td class="bad">4/5 · 4/5 (<code>holdsRestorePagesInsideThePerPageByteBudget</code>)</td></tr>
<tr><td class="mono">main 07e905aa = ac81c07d^ — alone, same host</td><td class="good">5/5</td></tr></table>
<pre>commit at revision 2 -> 409 managed_session_extension_record_rejected
"Record line 1 is not an event line, yet it sits among
 the transaction's events."</pre>
<div class="note">The failing case was added by #13348 (fd4af700, 15:50Z). #13355 (ac81c07d, 16:29Z) tightened extension-record validation, but its head a43bbc7b does not contain fd4af700, so its CI never ran that case. PR #13431 changes no Java: <code>packages/</code> on the merge is byte-identical to main. Any managed-agent-server unit stage on top of current main fails here until main is fixed — including this PR's next CI or merge-queue run.</div></div></div>
<div class="note">Both ITs that launch the five drivers pass on the merge with current main, as do the relay step, the failsafe-report check and the latency baseline. <code>HostedWorkspaceConcurrencyIT</code> is the same order-dependent cleanup FK seen in R1: here it runs 8th of 9, after the workspace ITs, while CI runs it 2nd, and alone on this merge it passes 1/1. <code>RuntimeBrokerDefaultOnTest</code> failed once in the first attempt and passed in the rerun and 2/2 alone (flaky; also Java-only). Because the unit error stops <code>mvn verify</code> before failsafe, this lane ran with <code>-Dmaven.test.failure.ignore=true</code> and every report was read individually.</div>`,
  );
  fs.writeFileSync(path.join(outDir, '06-r2-merge-lane.html'), html);
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
