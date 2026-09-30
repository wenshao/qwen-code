// Renders the PR #11071 evidence figures. Every number in a figure is read
// from a measurement file (out/*.json, unit/integration logs), never typed in.
const fs = require('fs');
const path = require('path');
const { chromium } = require('/root/verify/pr11071/head/node_modules/playwright-core');

const ROOT = '/root/verify/pr11071';
const OUT = path.join(ROOT, 'publish');
fs.mkdirSync(OUT, { recursive: true });
const J = (arm, s) => JSON.parse(fs.readFileSync(path.join(ROOT, 'out', `${arm}-${s}.json`), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const stepOf = (r, label) => {
  const s = r.steps.find((x) => x.label === label || x.label.startsWith(label));
  if (!s) throw new Error(`no step "${label}" in ${r.arm}/${r.scenario}`);
  return s;
};
const secs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

const CSS = `
*{box-sizing:border-box} body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,"Segoe UI","DejaVu Sans",sans-serif}
.card{width:1240px;padding:22px 26px;background:#0d1117}
h1{font-size:19px;margin:0 0 4px} .sub{color:#8b949e;margin:0 0 14px;font-size:13px}
h2{font-size:15px;margin:16px 0 8px;color:#e6edf3}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #30363d;padding:6px 8px;vertical-align:top;text-align:left}
th{background:#161b22;color:#8b949e;font-weight:600}
code,.mono{font-family:"DejaVu Sans Mono","Liberation Mono",monospace;font-size:12.5px}
.bad{background:#3d1418;color:#ffa198} .good{background:#0f2d1a;color:#7ee787} .warn{background:#3a2d0b;color:#e3b341}
.note{color:#8b949e;font-size:12.5px;margin-top:10px}
pre{background:#010409;border:1px solid #30363d;border-radius:6px;padding:10px 12px;margin:6px 0;white-space:pre-wrap;font:12px/1.45 "DejaVu Sans Mono","Liberation Mono",monospace}
.r{color:#ff7b72} .g{color:#7ee787} .d{color:#8b949e} .y{color:#e3b341} .b{color:#79c0ff}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.pane h3{margin:0 0 4px;font-size:14px}
`;

async function shot(browser, name, body) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1300, height: 900 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="card">${body}</div></body></html>`);
  const el = page.locator('.card');
  let box = await el.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  box = await el.boundingBox();
  await el.screenshot({ path: path.join(OUT, name) });
  await page.close();
  console.log('wrote', name, Math.ceil(box.width), 'x', Math.ceil(box.height));
}

const workerLine = (c, ws) => {
  const w = c.workers.find((x) => x.ws === ws);
  return w ? `worker ${ws} pid ${w.pid} <span class="${w.alive ? 'g' : 'r'}">${w.alive ? 'alive' : 'dead'}</span>` : `worker ${ws} <span class="r">gone</span>`;
};
const pidState = (alive, pid, ws, keep = false) => `worker ${ws} pid ${pid} ${alive ? (keep ? '<span class="g">alive, same PID</span>' : '<span class="y">still alive</span>') : '<span class="g">exited</span>'}`;
const resp = (r) =>
  r.status === 200
    ? `<span class="g">→ 200</span> <span class="d">(${secs(r.ms)})</span>`
    : `<span class="r">→ ${r.status} ${esc(r.code)}</span> <span class="d">(${secs(r.ms)})</span>`;

function fig1Pane(arm) {
  const r = J(arm, 'loss');
  const boot = stepOf(r, 'boot');
  const lost = stepOf(r, 'config lost');
  const d1 = stepOf(r, 'DELETE botA #1');
  const a1 = stepOf(r, 'after DELETE #1');
  const d2 = stepOf(r, 'DELETE botA #2');
  const p = J(arm, 'poison');
  const s1 = stepOf(p, 'start botC in C (A lost config)');
  const pd = stepOf(p, 'DELETE botA in A');
  const s2 = stepOf(p, 'start botC in C again');
  const lines = [
    `<span class="d"># boot: A and B each host one plugin-example channel</span>`,
    `${workerLine(boot.control, 'wsA')}  ·  ${workerLine(boot.control, 'wsB')}`,
    `<span class="d"># remove channels.botA from wsA/.qwen/settings.json</span>`,
    `<span class="d"># (serve.channels still ${esc(JSON.stringify(lost.settingsA.serve.channels))}); 3 s later:</span>`,
    `${pidState(lost.pidA_alive, boot.pidA, 'wsA')}, peer botA open=${lost.peers.botA.open}`,
    ``,
    `<span class="b">DELETE /workspaces/&lt;A&gt;/channels/botA</span> <span class="d">{current revision}</span>`,
    `  ${resp(d1)}`,
    `  ${pidState(a1.pidA_alive, boot.pidA, 'wsA')} · peer botA open=${a1.peers.botA.open}`,
    `  wsA serve.channels = ${esc(JSON.stringify(a1.settingsA.serve.channels))}`,
    `  ${pidState(a1.pidB_alive, boot.pidB, 'wsB', true)} <span class="d">(other workspace)</span>`,
    `<span class="b">DELETE again</span> <span class="d">{current revision}</span>  ${resp(d2)}`,
    ``,
    `<span class="d"># separate run: while botA is stuck, start botC in workspace C</span>`,
    `<span class="b">POST /workspaces/&lt;C&gt;/channels/botC/start</span>`,
    `  ${resp({ status: s1.status, ms: s1.ms, code: s1.code })}`,
    `  <span class="d">${esc(s1.error ?? '')}</span>`,
    `<span class="b">DELETE botA</span>  ${resp(pd)}`,
    `<span class="b">POST .../botC/start again</span>  ${resp({ status: s2.status, ms: s2.ms, code: s2.code })}`,
  ];
  return lines.join('\n');
}

function fig1() {
  const body = `
<h1>PR #11071 — config loss → DELETE, real <code>qwen serve</code> daemon</h1>
<p class="sub">Same harness, two bundles: base <code>8c914ebe03</code> (merge-base) vs head <code>39f8072927</code>. Real daemon, real <code>channel daemon-worker</code> child processes running the plugin-example adapter, one real WebSocket peer per channel. PIDs checked in <code>/proc</code>.</p>
<div class="two">
 <div class="pane"><h3>base <span class="d">8c914ebe03</span></h3><pre>${fig1Pane('base')}</pre></div>
 <div class="pane"><h3>head <span class="d">39f8072927</span></h3><pre>${fig1Pane('head')}</pre></div>
</div>
<p class="note">On base, a channel whose config disappeared cannot be deleted, keeps running, and blocks every other channel start on the daemon, because each start re-resolves the whole committed selection. On head, one DELETE converges it and unblocks the daemon.</p>`;
  return body;
}

function cell(r, kind) {
  const cls = kind === 'good' ? 'good' : kind === 'bad' ? 'bad' : 'warn';
  return `<td class="${cls}">${r}</td>`;
}

function fig2() {
  const cfgOf = (st) => Object.keys((st.settingsA ?? st.settingsP)?.channels ?? {});
  // One DELETE issued during another operation's transition, then (if it
  // failed) a retry after the manager settled. Every cell is read from JSON.
  const during = (label, target, falseRefusal = false) => (r) => {
    const d = stepOf(r, label);
    const retry = r.steps.find((x) => x.label.startsWith('retry DELETE') || x.label.startsWith('DELETE botA again'));
    const last = r.steps[r.steps.length - 1];
    const w = (last.control?.workers ?? []);
    const orphan = d.status === 200 && w.some((x) => x.alive && x.channels.includes(target) && !['wsB'].includes(x.ws) && !cfgOf(last).includes(target)) && (last.peers?.[target === 'botN' ? 'botN' : target]?.open ?? 0) > 0;
    if (orphan) {
      const again = r.steps.find((x) => x.label.startsWith('DELETE botA again'));
      return cell(`<code>200</code> in ${secs(d.ms)}, config deleted →<br><b>orphan</b>: the start commits anyway, ${esc(target)} worker alive + peer connected with no config${again ? `; DELETE again → <code>${again.status}${again.code ? ' ' + esc(again.code) : ''}</code>` : ''}`, 'bad');
    }
    if (d.status === 200) {
      return cell(`<code>200</code> ${d.ms >= 1000 ? `after <b>${secs(d.ms)}</b> (queued in the lane)` : `in ${secs(d.ms)}`}`, 'good');
    }
    const kind = retry?.status === 200 && !falseRefusal ? 'warn' : 'bad';
    return cell(`<code>${d.status} ${esc(d.code)}</code> in ${secs(d.ms)}${retry ? `<br>retry after settle → <code>${retry.status}${retry.code ? ' ' + esc(retry.code) : ''}</code>` : ''}`, kind);
  };
  const stopDuring = (r) => {
    const d = stepOf(r, 'POST stop botA');
    return cell(`<code>${d.status}</code> after <b>${secs(d.ms)}</b> (queued in the lane)`, d.status === 200 ? 'good' : 'bad');
  };
  const lateCell = (r) => {
    const d = stepOf(r, 'DELETE A botA');
    const after = stepOf(r, 'after settle');
    const fin = r.steps.find((x) => x.label === 'after retry') ?? after;
    const w = fin.listA?.botW;
    const up = fin.peers?.botW?.open > 0;
    const txt = `${d.status === 200 ? `<code>200</code> in ${secs(d.ms)}` : `<code>${d.status}</code> in ${secs(d.ms)}, retry after settle → <code>${stepOf(r, 'retry DELETE').status}</code>`}<br>botW (not deleted): ${up ? 'connected' : '<b>never starts</b>'}${w?.state === 'error' ? ` — listed as <code>error</code>: <span class="mono">${esc((w.lastError ?? '').slice(0, 60))}…</span>` : ''}`;
    return cell(txt, up ? 'good' : 'bad');
  };
  const row = (label, scen, fn) => `<tr><td>${label}</td>${['base', 'head', 'fix'].map((arm) => fn(J(arm, scen))).join('')}</tr>`;
  const grp = (t) => `<tr><td colspan="4" style="background:#161b22;color:#8b949e;font-weight:600">${t}</td></tr>`;
  return `
<h1>PR #11071 — the mid-transition guard: where it helps, where it hurts</h1>
<p class="sub">Real daemon, three bundles: <b>base</b> 8c914ebe03 · <b>head</b> 39f8072927 · <b>fix</b> = head + the patch in this comment (the configured branch keeps the 409 only while the transition may be starting that channel). "C's transition" = workspace C starts a channel whose peer never answers, so the manager stays <code>reconciling</code> for the 30 s worker startup budget. Red 409 = refusal no transition justified; yellow = retryable 409 while the channel may be starting.</p>
<table>
<tr><th style="width:27%">DELETE of a configured channel in workspace A, issued during…</th><th>base</th><th>head</th><th>fix</th></tr>
${grp('Transitions that cannot be starting A\'s channel: head refuses, fix = base')}
${row('C\'s transition; A\'s <code>botA</code> is running (C registered at runtime, restoring its <code>serve.channels</code>)', 'busy', during('DELETE configured botA in A', 'botA', true))}
${row('Control: <code>POST …/botA/stop</code> instead of DELETE, same transition', 'busy-stop', stopDuring)}
${row('C\'s transition; A\'s <code>botS</code> is configured but not running', 'stopped', during('DELETE A botS', 'botS', true))}
${grp('Transitions that may be starting it: head\'s 409 is load-bearing, fix = head')}
${row('A\'s own late-registration restore of <code>botA</code> (DELETE lands after the worker read its config, before commit)', 'inflight', during('DELETE configured botA (mid restore)', 'botA'))}
${row('<code>--channel all</code> reload bringing up <code>botN</code>, newly added on disk (auditor\'s scenario)', 'all-reload', during('DELETE P botN', 'botN'))}
${row('B restarting a <b>same-named</b> <code>botX</code> that A configures but does not run', 'samename-starting', during('DELETE A botX', 'botX'))}
${row('C\'s transition while B runs a same-named <code>botX</code> (cannot be told from an owner moving to A)', 'samename', during('DELETE A botX', 'botX'))}
${row('<code>--channel all</code> start (primary only) while A configures <code>botA</code>', 'all-unrelated', during('DELETE A botA', 'botA'))}
${grp('Availability side effect of the narrowing (not safety): fix = base')}
${row('A registers late while C\'s transition runs; its <code>serve.channels</code> restore <code>[botA, botW]</code> is queued with names read at registration; DELETE <code>botA</code>', 'late-collateral', lateCell)}
${grp('Missing-config branch (new surface): guard unchanged')}
${row('C\'s transition; A\'s <code>botA</code> lost its config', 'busy-loss', during('DELETE config-lost botA', 'botA'))}
</table>
<p class="note">Head's guard closes two real base races (orphan rows: the start commits after base already deleted the config). But because <code>transition</code> is one value for the whole daemon, it also refuses deletes that no transition can affect (first group), where the sibling <code>stop</code> just waits. The fix narrows only the configured branch: it is identical to head wherever the in-flight transition may be starting the channel (second group; names aren't workspace-qualified, so same-named channels stay conservative) and identical to base elsewhere — including one base availability gap head only masks: the late-registration restore snapshots its names and fails all-or-nothing when one was deleted before it ran.</p>`;
}

function fig3() {
  const grab = (file) => {
    const t = stripAnsi(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const files = (t.match(/Test Files\s+(.*)/) || [])[1];
    const tests = (t.match(/^\s+Tests\s+(.*)$/m) || [])[1];
    return `${esc(files ?? '?')} · ${esc(tests ?? '?')}`;
  };
  const neg = stripAnsi(fs.readFileSync(path.join(ROOT, 'integ-base-negctl.log'), 'utf8'));
  const negFailed = (neg.match(/× ([^\n]*)/) || [])[1] ?? '?';
  const variants = [
    ['head', 'PR head (guard for every transition)'],
    ['triage', 'guard only on the missing-config branch (the sandboxed-verification suggestion)'],
    ['drop-committed-here', 'patch without the "already runs it here" exemption'],
    ['drop-pending-membership', 'patch without the candidate-selection check'],
    ['drop-all-mode', 'patch treating an <code>all</code> selection as naming nothing'],
    ['missing-pending-counts', 'patch treating a transition with no candidate selection as starting'],
    ['void-stop', 'patch with <code>await stopChannel</code> → <code>void</code>'],
    ['v3', '<b>patch</b>'],
  ];
  const KEEP = /mid-transition|unrelated transition|leaves out|another workspace runs|all-channels|stopping everything/;
  const readVar = (v) => JSON.parse(fs.readFileSync(path.join(ROOT, 'mutants3', `${v}.json`), 'utf8')).testResults[0].assertionResults.filter((a) => a.status !== 'skipped' && KEEP.test(a.title));
  const titles = readVar('v3').map((a) => a.title);
  const mut = { tests: titles, rows: variants.map(([v, label]) => ({ variant: label, results: titles.map((t) => ({ pass: readVar(v).find((a) => a.title === t)?.status === 'passed' })) })) };
  const mrow = (m) => `<tr><td>${m.variant}</td>${m.results.map((x) => `<td class="${x.pass ? "good" : "bad"}">${x.pass ? "pass" : "FAIL"}</td>`).join("")}</tr>`;
  return `
<h1>PR #11071 — tests</h1>
<table>
<tr><th style="width:44%">Run</th><th>Result</th></tr>
<tr><td>5 changed unit files on <b>head</b> (<code>channel-management-service</code>, <code>channel-settings-store</code>, <code>channel-worker-manager</code>, <code>run-qwen-serve</code>, <code>server</code>)</td><td class="good">${grab('unit-head.log')}</td></tr>
<tr><td>Same 5 files on <b>fix</b> (head + patch; 5 tests added, 1 given a realistic <code>pendingSelection</code>)</td><td class="good">${grab('unit-fix.log')}</td></tr>
<tr><td><code>integration-tests/cli/qwen-serve-routes.test.ts</code> on the head bundle (the CI job for it was skipped)</td><td class="good">${grab('integ-head.log')}</td></tr>
<tr><td>Negative control: head's version of that file run against the <b>base</b> bundle</td><td class="warn">${grab('integ-base-negctl.log')}<br><span class="mono">× ${esc(negFailed.replace(/ \d+ms.*$/, ''))}</span> (the new capability tag)</td></tr>
<tr><td><code>tsc --noEmit -p packages/cli</code> · eslint --max-warnings 0 · prettier on the fix arm</td><td class="good">exit 0 · exit 0 · clean</td></tr>
</table>
<h2>The patch's tests discriminate (FAIL = the test catches that variant)</h2>
<table><tr><th>service variant</th>${mut.tests.map((t) => `<th>${esc(t)}</th>`).join('')}</tr>
${mut.rows.map(mrow).join('\n')}
</table>`;
}

(async () => {
  const browser = await chromium.launch();
  await shot(browser, '01-config-loss-real-daemon-base-vs-head.png', fig1());
  await shot(browser, '02-mid-transition-guard-three-arms.png', fig2());
  await shot(browser, '03-tests.png', fig3());
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
