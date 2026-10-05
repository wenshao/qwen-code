const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const OUT = '/root/verify/pr13289/publish/pr13289/r5';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{display:inline-block;padding:22px 26px;min-width:1100px;max-width:1500px}
h1{font-size:19px;margin:0 0 4px} .sub{color:#8b949e;font-size:12.5px;margin:0 0 14px;max-width:1440px}
table{border-collapse:collapse;font-size:13px} th,td{border:1px solid #30363d;padding:6px 9px;vertical-align:top;text-align:left}
th{background:#161b22;color:#c9d1d9;font-weight:600} code,.mono{font-family:"DejaVu Sans Mono",Menlo,Consolas,monospace;font-size:12px}
.bad{color:#ff7b72;font-weight:600} .good{color:#3fb950;font-weight:600} .warn{color:#d29922;font-weight:600} .dim{color:#8b949e}
.case{font-weight:600;white-space:nowrap} .tag{display:inline-block;border:1px solid #30363d;border-radius:10px;padding:0 7px;font-size:11.5px;color:#8b949e;margin-left:4px}
pre{margin:0;font-family:"DejaVu Sans Mono",Menlo,Consolas,monospace;font-size:12.3px;line-height:1.5;background:#010409;border:1px solid #30363d;border-radius:6px;padding:12px 14px;white-space:pre}
.k{color:#79c0ff} .foot{color:#8b949e;font-size:12px;margin-top:10px;max-width:1440px}
`;
function page(title, sub, body, foot) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="wrap"><h1>${title}</h1><div class="sub">${sub}</div>${body}${foot ? `<div class="foot">${foot}</div>` : ''}</div></body></html>`;
}
const figures = [];

// R5-01: matrix
figures.push(['r5-01-r3-30-ab.png', page(
  'R3-30 reproduced on a real Hosted topology — head <code>374a523c66</code> vs head + the suggested two-line fix',
  'Spring Session Store + embedded Runtime Broker + bundled durable local-process workers + packaged <code>qwen serve --profile hosted-harness</code>, Broker defaults from <code>application.yml</code> (durable workers, trusted reboot recovery on, verified Workspace recovery off). Operator steps are the PR\'s own entry points run as separate JVMs. <b>Boot B</b> = same database and state directory, Spring JVM started in a private mount namespace whose <code>/proc/sys/kernel/random/boot_id</code> is a fresh UUID (simulated host reboot; workers SIGKILLed at the end of boot A).',
  `<table>
<tr><th>Workspace case</th><th>First turn (boot A)</th><th>LOCAL lease rows</th><th>Operator<br><code>WorkspaceCsiRegistrationMain register</code></th><th>Boot A: workers SIGKILLed</th><th>Boot B: original binding</th><th>Placement probe, same tenant+storage<br><code>kubernetes-workspace</code> / <code>local-process</code></th></tr>
<tr><td class="case" rowspan="2">warmreg</td><td rowspan="2">text-only answer<br><code>runtimes:warm</code> 200, no <code>acquire</code></td><td rowspan="2" class="warn">0</td><td rowspan="2" class="warn">accepted<br><span class="dim">"CSI registration persisted"</span><br>next tool turn: <code>warm</code> 409 <code>workspace_unavailable</code></td><td rowspan="2">LOST<br><span class="dim">loss=registered-process-exit, no stop proof (same boot)</span></td>
  <td><span class="tag">head</span> <span class="bad">LOST forever</span><br><span class="dim">stop=trusted-host-reboot recorded, <code>releaseLost</code> refused; record_version 61→321 in 212 s, 0 log lines</span></td><td><span class="tag">head</span> <span class="bad">409 / 409</span><br><code>runtime_placement_recovery_required</code></td></tr>
<tr><td><span class="tag">fix</span> <span class="good">RELEASED</span> by the first sample (0.77 s / 0.88 s)</td><td><span class="tag">fix</span> <span class="good">admitted / admitted</span></td></tr>
<tr><td class="case">warmnoreg<br><span class="dim">control</span></td><td>text-only answer</td><td>0</td><td class="dim">not run</td><td>LOST (same)</td><td><span class="good">RELEASED</span> on both arms</td><td><span class="good">admitted / admitted</span></td></tr>
<tr><td class="case">toolfirst<br><span class="dim">control</span></td><td>Shell tool<br><code>acquire</code> 200 → lease row</td><td>1</td><td class="good">refused<br><span class="dim">"Workspace CSI admission is unavailable."</span></td><td>LOST (same)</td><td><span class="good">RELEASED</span> on both arms</td><td><span class="good">admitted / admitted</span></td></tr>
</table>`,
  'Four full runs, identical on <b>MySQL 8.4.11</b> and <b>MariaDB 11.4.13</b>: head×MySQL, head×MariaDB, fix×MySQL, fix×MariaDB. The fix arm differs from head only by removing <code>requireLocalAlias</code> from <code>WorkspaceExecutionStore.releaseLost</code>; the fence on new work is unchanged (warmreg\'s new Session still gets <code>warm</code> 409 <code>workspace_unavailable</code> on both arms).'
)]);

// R5-02: log excerpt
const L = (t, s) => `<span class="dim">${esc(t.padStart(8))}</span>  ${s}`;
const pre = [
  '<span class="k">── boot A  (real boot_id 0a939ae1…)  MySQL 8.4.11, head 374a523c66 ─────────────────────────────────────────────</span>',
  L('1.3 s', 'warmreg   turn 1 text-only    broker: <span class="good">warm 200</span>                 binding ac047958 READY, LOCAL lease rows: <span class="warn">0</span>'),
  L('2.4 s', 'warmreg   operator  WorkspaceCsiRegistrationMain register  → exit 0 <span class="warn">"CSI registration persisted; mounting remains disabled."</span>'),
  L('2.6 s', 'warmreg   turn 2 Shell tool   broker: <span class="good">warm 409 workspace_unavailable</span> → turn_error hosted_turn_failed   (new work fenced)'),
  L('4.7 s', 'toolfirst turn 1 Shell tool   broker: warm 200, acquire 200, …, release 200   LOCAL lease rows: 1'),
  L('5.4 s', 'toolfirst operator  WorkspaceCsiRegistrationMain register  → exit 1 <span class="good">"Workspace CSI admission is unavailable."</span>'),
  L('5.5 s', 'SIGKILL all three workers (what a reboot does to them)'),
  L('11.8 s', 'warmreg / warmnoreg / toolfirst → LOST   loss=registered-process-exit, stop=none   <span class="dim">(same boot: no writer-stop proof, every arm)</span>'),
  L('38.7 s', 'warmreg   operator  WorkspaceRecoveryCommand inspect → <span class="bad">"Workspace execution authority is unavailable."</span>'),
  L('41.0 s', 'warmnoreg operator  WorkspaceRecoveryCommand inspect → "Exact Hosted Shell operator recovery is unavailable."  <span class="dim">(no holder: not an escape here)</span>'),
  '',
  '<span class="k">── boot B  (private mount ns, boot_id 90ccff90…)  same DB + state directory ────────────────────────────────────</span>',
  L('0.7 s', 'toolfirst → <span class="good">RELEASED</span>  stop=trusted-host-reboot          warmnoreg → <span class="good">RELEASED</span>  stop=trusted-host-reboot'),
  L('0.7 s', 'warmreg   → <span class="bad">LOST</span>      stop=trusted-host-reboot recorded, recoverResources → releaseLost → requireLocalAlias throws'),
  L('122.5 s', 'warmreg   new Session text turn   broker: warm 409 workspace_unavailable'),
  L('212.7 s', 'warmreg   still <span class="bad">LOST</span>, record_version 61 → 321 (reconcile keeps re-claiming), no WARN/ERROR line in the server log'),
  L('214 s', 'placement probe, same tenant+storage: kubernetes-workspace <span class="bad">409 runtime_placement_recovery_required</span>, local-process <span class="bad">409</span>'),
  L('', 'controls: kubernetes-workspace / local-process <span class="good">admitted</span>'),
].join('\n');
figures.push(['r5-02-head-timeline.png', page(
  'Head arm, MySQL: the warmreg chain end to end (driver log, condensed)',
  'Times are from the driver\'s own clock in each boot. Same chain on MariaDB 11.4.13 (record_version 61 → 321 in 212 s). The fix arm diverges only at boot B: warmreg → RELEASED at 0.77 s (MySQL) / 0.88 s (MariaDB), probes admitted.',
  `<pre>${pre}</pre>`
)]);

// R5-03: merge + suites
const conflict = [
  '<span class="k">$ git merge origin/main   # PR head 374a523c66 + main dd82140bcd (16 commits since 9766e72234)</span>',
  'CONFLICT (content): Merge conflict in packages/core/src/managed-runtime/http-managed-session-store.test.ts',
  '<span class="dim"># the only file both sides touched; 9 hunks, all the same shape:</span>',
  '<span class="bad">-      baseUrl: \'http://127.0.0.1:8080\',</span>          <span class="dim">(PR)</span>',
  '<span class="good">+      baseUrl: \'http://session-store.test\',</span>     <span class="dim">(main #13434)</span>',
  '<span class="good">+      allowInsecureHttp: true,</span>',
  '<span class="dim"># resolved by taking main\'s side in all 9 hunks; no migration collision (main added none after V40)</span>',
].join('\n');
figures.push(['r5-03-trial-merge.png', page(
  'Trial merge with current main and Java suites (local, not pushed)',
  'Linux x86_64, Node 22.22.2, Temurin JDK 21.0.12, Maven 3.9.9, pnpm 11.24.0.',
  `<pre>${conflict}</pre><br><table>
<tr><th>Check</th><th>Arm</th><th>Result</th></tr>
<tr><td><code>http-managed-session-store.test.ts</code> (the conflicted file)</td><td>trial merge</td><td class="good">51 / 51 passed</td></tr>
<tr><td><code>npm run build</code> + root <code>npm run typecheck</code></td><td>trial merge</td><td class="good">exit 0 / exit 0</td></tr>
<tr><td>managed-agent-server full unit suite (<code>mvn test</code>)</td><td>trial merge</td><td class="good">943 tests, 0 failures, 0 errors</td></tr>
<tr><td>runtime-broker full unit suite</td><td>trial merge</td><td id="rb">RB_RESULT</td></tr>
<tr><td>managed-agent-server full unit suite</td><td>head + R3-30 fix</td><td class="good">931 tests, 0 failures, 0 errors</td></tr>
<tr><td>Real-topology R3-30 IT (4 runs above)</td><td>head / head + fix</td><td>head: <span class="bad">reproduced</span> on both engines; fix: <span class="good">resolved</span> on both engines</td></tr>
<tr><td>CI at head <code>374a523c66</code></td><td>PR</td><td>25 pass, 9 skipping, 0 failing; GitHub reports <span class="warn">CONFLICTING</span></td></tr>
</table>`
)]);

(async () => {
  const rb = fs.existsSync('/root/verify/pr13289/rb-result.txt') ? fs.readFileSync('/root/verify/pr13289/rb-result.txt', 'utf8').trim() : 'pending';
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const [name, html0] of figures) {
    const html = html0.replace('RB_RESULT', rb);
    const pageObj = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    await pageObj.setContent(html);
    const box = await pageObj.locator('.wrap').boundingBox();
    await pageObj.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    const box2 = await pageObj.locator('.wrap').boundingBox();
    await pageObj.screenshot({ path: path.join(OUT, name), clip: box2 });
    fs.writeFileSync(path.join('/root/verify/pr13289/publish', name.replace('.png', '.html')), html);
    await pageObj.close();
    console.log('wrote', name, Math.round(box2.width), 'x', Math.round(box2.height));
  }
  await browser.close();
})();
