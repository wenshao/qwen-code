// Renders the evidence figures from facts.json and the captured logs.
// Every number in a figure is read from a measurement file, never typed in.
const fs = require('fs');
const path = require('path');
const { chromium } = require('/root/git/qwen-code-x8/node_modules/playwright-core');

const H = __dirname;
const OUTDIR = path.join(H, 'figs');
fs.mkdirSync(OUTDIR, { recursive: true });
const F = JSON.parse(fs.readFileSync(path.join(H, 'facts.json'), 'utf8'));
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\u23af/g, '-');

const CSS = `
*{box-sizing:border-box} body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,"Segoe UI","DejaVu Sans",sans-serif}
.card{width:1180px;padding:22px 26px;background:#0d1117}
h1{font-size:19px;margin:0 0 4px} .sub{color:#8b949e;margin:0 0 14px;font-size:13px}
h2{font-size:15px;margin:18px 0 8px;color:#e6edf3}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #30363d;padding:6px 8px;vertical-align:top;text-align:left}
th{background:#161b22;color:#8b949e;font-weight:600}
code,.mono{font-family:"DejaVu Sans Mono","Liberation Mono",monospace;font-size:12.5px}
.bad{background:#3d1418;color:#ffa198} .good{background:#0f2d1a;color:#7ee787} .neutral{color:#c9d1d9}
.tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;font-weight:600}
.tag.bad{border:1px solid #f85149} .tag.good{border:1px solid #3fb950} .tag.warn{background:#3a2d0b;color:#e3b341;border:1px solid #9e6a03}
.note{color:#8b949e;font-size:12.5px;margin-top:10px}
pre{background:#010409;border:1px solid #30363d;border-radius:6px;padding:10px 12px;margin:6px 0;white-space:pre-wrap;font-size:12px;line-height:1.4}
.r{color:#ff7b72} .g{color:#7ee787} .d{color:#8b949e} .y{color:#e3b341}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
`;

async function shot(browser, name, body) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1240, height: 900 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="card">${body}</div></body></html>`);
  const el = page.locator('.card');
  const box = await el.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await el.screenshot({ path: path.join(OUTDIR, name) });
  await page.close();
  console.log('wrote', name);
}

const sel = (v) => (v.selection ? `[${v.selection.join(', ')}]` : 'null');
const peer = (v, n) => (v.peers[n] ? `${v.peers[n][0]} connects / ${v.peers[n][1]} open` : '');
const workers = (v) =>
  v.workers.length
    ? v.workers.map((w) => `${w[0]} ${JSON.stringify(w[1])} pid ${w[2]}`).join('<br>')
    : '—';

function fig1() {
  const e2e = {};
  for (const arm of ['base', 'head', 'fix']) {
    const log = stripAnsi(fs.readFileSync(path.join(H, '..', `e2e-${arm}.log`), 'utf8'));
    const m = log.match(/^\s+Tests\s+(.*)$/m);
    const late = log.match(/([✓×]) qwen serve multi-workspace channel workers > restores a workspace registered after boot[^\n]*/);
    e2e[arm] = { summary: m ? m[1].trim() : '?', late: late ? late[0].replace(/^.*> /, late[1] + ' ') : '?' };
  }
  const row = (label, arm, cls) => {
    const v = F[`late_${arm}`];
    return `<tr><td><b>${label}</b></td><td class="mono">${v.post_status} in ${v.post_ms} ms</td>
      <td class="mono ${cls}">${workers(v.final)}</td><td class="mono ${cls}">${peer(v.final, 'a')}</td>
      <td class="mono">${esc(e2e[arm].summary)}<br><span class="d">${esc(e2e[arm].late)}</span></td></tr>`;
  };
  return `<h1>Central claim — a workspace registered after boot brings up its own serve.channels</h1>
  <p class="sub">Real <code>qwen serve</code> bundle per arm · real plugin-example adapter · one real WebSocket peer per channel that counts connects · daemon boots with a channel-less primary, then <code>POST /workspaces</code> registers wsA whose settings list <code>serve.channels: ["a"]</code></p>
  <table><tr><th>arm</th><th>POST /workspaces</th><th>workers after 3 s (GET /workspace/channel)</th><th>peer "a"</th><th>PR test plan: <code>cli/qwen-serve-channel-workers.test.ts</code></th></tr>
  ${row('base c822995d', 'base', 'bad')}${row('head c00d3854', 'head', 'good')}${row('head + 5-line patch', 'fix', 'good')}</table>
  <p class="note">Integration runs swap <code>dist/</code> per arm (globalSetup pins <code>TEST_CLI_PATH</code> to <code>dist/cli.js</code>). Base fails only the new case, after 3 retries — the discrimination the PR describes.</p>`;
}

function timeline(key, arms, labels, highlightLast) {
  const rows = F[`${key}_${arms[0]}`].map((s, i) => {
    const cells = arms.map((arm) => {
      const v = F[`${key}_${arm}`][i];
      const last = i === F[`${key}_${arm}`].length - 1;
      let cls = '';
      if (last && highlightLast) cls = highlightLast(arm, v);
      return `<td class="mono ${cls}">sel ${sel(v)}<br>${Object.keys(v.peers).map((n) => `${n}: ${peer(v, n)}`).join('<br>')}<br><span class="d">${workers(v)}</span></td>`;
    });
    return `<tr><td><b>${esc(s.label)}</b>${s.status ? ` <span class="d">→ ${s.status}</span>` : ''}</td>${cells.join('')}</tr>`;
  });
  return `<table><tr><th style="width:230px">step</th>${labels.map((l) => `<th>${l}</th>`).join('')}</tr>${rows.join('')}</table>`;
}

function fig2() {
  const reviveCls = (arm, v) => (v.selection && v.selection.includes('bot') ? 'bad' : 'good');
  return `<h1>Finding 1 (reproduced) — a channel the operator stopped comes back when a late workspace is removed and registered again</h1>
  <p class="sub">wsA (registered at boot, non-primary) and wsB/wsC are checkouts of one repo: identical <code>.qwen/settings.json</code> defining <code>bot</code> + <code>other</code> (no <code>cwd</code>) and <code>serve.channels: ["bot","other"]</code>. wsB lists only names wsA already hosts, so the hook returns at <code>pending.length === 0</code> before <code>lateRestoredWorkspaces.add()</code>.</p>
  ${timeline('shared_rereg', ['base', 'head', 'fix'], ['base c822995d', 'head c00d3854', 'head + 5-line patch'], reviveCls)}
  <h2>Same fixture, but a never-seen checkout wsC registers after the stop (not covered by any once-per-workspace rule)</h2>
  ${timeline('shared_fresh', ['base', 'head', 'fix'], ['base', 'head', 'head + patch'], reviveCls).replace(/<tr><td><b>boot[\s\S]*?<\/tr>/, '')}
  <p class="note">"stop" = <code>POST /workspaces/:wsA/channels/bot/stop</code> → 200. The second table is the per-channel-intent limitation already tracked in #12432; the patch does not claim to fix it.</p>`;
}

function fig3() {
  const cls = (arm, v) => (v.peers.a1 && v.peers.a1[1] > 0 ? 'bad' : 'good');
  return `<h1>S1 on a real daemon — "once per daemon" holds on the wire, and the record is load-bearing</h1>
  <p class="sub">wsA registers after boot with <code>serve.channels: ["a1","a2"]</code>; the operator stops a1 through wsA, then wsA is removed and registered again. <b>M1</b> = head with <code>lateRestoredWorkspaces.add(workspaceCwd)</code> deleted.</p>
  <h2>Primary also hosts its own channel p (hosting stays enabled after wsA is removed)</h2>
  ${timeline('once_hosted', ['head', 'm1', 'fix'], ['head', 'M1 mutant', 'head + patch'], cls)}
  <h2>wsA is the only hosting workspace — removal turns hosting off, so the <code>!enabled</code> guard masks M1</h2>
  ${timeline('once_multi', ['head', 'm1'], ['head', 'M1 mutant'], cls)}
  <p class="note">A single-workspace two-channel fixture (the one the sandboxed round proposed but did not build) does not separate M1 from head on a real daemon: permanent removal drops wsA's names, the selection empties, <code>stopSelectionNow()</code> runs, and the hook exits at the stopped-hosting guard first.</p>`;
}

function fig4() {
  const byGap = {};
  for (const r of F.race_head) (byGap[r.gap] ??= []).push(r);
  const gapRows = Object.keys(byGap)
    .map(Number)
    .sort((a, b) => a - b)
    .map((g) => {
      const rs = byGap[g];
      const ok = rs.filter((r) => r.both_running).length;
      const second = rs.map((r) => r.post_ms[1]);
      return `<tr><td class="mono">${g < 0 ? 'concurrent' : g + ' ms'}</td><td class="mono ${ok === rs.length ? 'good' : 'bad'}">${ok}/${rs.length}</td><td class="mono">${second.join(', ')} ms</td></tr>`;
    });
  const baseSecond = F.race_base.map((r) => r.post_ms[1]).join(', ');
  const burstOk = F.burst.map((b) => `${b.running}/6`).join(', ');
  const rs = F.race_stop_150.at(-1);
  const rd = F.race_delete_30.at(-1);
  const by = (arm) => F[`bystander_${arm}`].cRegistrationMs.toLocaleString('en-US');
  const poisonLog = F.poison_head.log.map((l) => esc(l.replace(/^\S+ /, '').slice(0, 170))).join('\n');
  return `<h1>Finding 2 (Stage 3) does not reproduce on a real daemon — and the thing that masks it has a measurable cost</h1>
  <p class="sub">wsA and wsB each list one channel of their own; the daemon booted with none. Outcome = both workers running and selection <code>[a, b]</code> after settling.</p>
  <div class="two"><div>
  <table><tr><th>wsB registered after wsA</th><th>both running</th><th>wsB <code>POST /workspaces</code> (3 runs)</th></tr>${gapRows.join('')}
  <tr><td class="mono">base, 0 / 250 ms</td><td class="mono d">nothing restored</td><td class="mono">${baseSecond} ms</td></tr></table>
  <table style="margin-top:10px"><tr><th>other shapes</th><th>result</th></tr>
  <tr><td>6 workspaces registered concurrently, ×3</td><td class="mono good">${burstOk} running</td></tr>
  <tr><td>operator stops q (in flight) + register wsB 150 ms later</td><td class="mono good">sel ${sel(rs)}, q ${peer(rs, 'q')}</td></tr>
  <tr><td>operator DELETE (in flight) + register wsB 30 ms later</td><td class="mono good">enabled ${rd.enabled}, sel ${sel(rd)}, b ${peer(rd, 'b')}</td></tr></table>
  </div><div>
  <table><tr><th colspan="2">Why: the same hook first awaits <code>restoreWorkspace()</code> / <code>refreshWorkspaces()</code> on the manager lane, so wsB reads the committed selection only after wsA's restore commits. wsB's POST returns ~10 ms after peer "a" connects.</th></tr>
  <tr><th>Cost — wsC configures <b>no channels</b>, registers 300 ms after wsA whose peer accepts TCP and never answers</th><th>wsC POST</th></tr>
  <tr><td>base c822995d</td><td class="mono good">${by('base')} ms</td></tr>
  <tr><td>head c00d3854</td><td class="mono bad">${by('head')} ms</td></tr>
  <tr><td>head + 5-line patch</td><td class="mono bad">${by('fix')} ms</td></tr></table>
  <table style="margin-top:10px"><tr><th>A late restore that fails reads as "hosting stopped" to the next workspace</th></tr>
  <tr><td><pre>${poisonLog}</pre><span class="mono">healthy wsD afterwards: sel ${sel(F.poison_head.steps[1])}, d ${peer(F.poison_head.steps[1], 'd')}</span></td></tr></table>
  </div></div>`;
}

function fig5() {
  const red = stripAnsi(fs.readFileSync(path.join(H, 'out', 'unit-red.ansi'), 'utf8'));
  const green = stripAnsi(fs.readFileSync(path.join(H, 'out', 'unit-green.ansi'), 'utf8'));
  const redExcerpt = red
    .split('\n')
    .filter((l) => /FAIL|Expected|Received|"other"|"shared"|"names"|Tests |Test Files/.test(l))
    .slice(0, 14)
    .map((l) => {
      const t = esc(l);
      if (/\+\s+"shared"|FAIL|failed/.test(l)) return `<span class="r">${t}</span>`;
      return t;
    })
    .join('\n');
  const verbose = stripAnsi(fs.readFileSync(path.join(H, 'out', 'unit-green-verbose.ansi'), 'utf8'));
  const greenExcerpt = [
    ...verbose.split('\n').filter((l) => /✓|×|Tests /.test(l)).map((l) => l.replace('src/serve/run-qwen-serve.test.ts > runQwenServe channel worker supervisor > ', '')),
    '',
    ...green.split('\n').filter((l) => /Test Files|Tests /.test(l)).map((l) => 'all four suites: ' + l.trim()),
  ]
    .map((l) => (/✓|passed/.test(l) ? `<span class="g">${esc(l)}</span>` : esc(l)))
    .join('\n');
  const tsc = fs.readFileSync(path.join(H, '..', 'tsc-fix.log'), 'utf8').trim().split('\n').at(-1);
  return `<h1>Patch for Finding 1 — regression test red on head, suites green with the patch</h1>
  <p class="sub">New case <code>counts a registration whose names were all hosted as its one restore</code> (PR's own fixture shape from <code>does not move a hosted channel…</code>): boot hosts [shared, other] in <code>hosting</code>; <code>claimant</code> registers; operator narrows to [other]; claimant is removed and registered again.</p>
  <h2>head c00d3854 production code + new test</h2><pre>${redExcerpt}</pre>
  <h2>head + patch — run-qwen-serve / channel-startup-restore / channel-workspace-grouping / channel-worker-manager</h2><pre>${greenExcerpt}</pre>
  <p class="mono">packages/cli <code>tsc --noEmit</code>: ${esc(tsc)} · eslint --max-warnings 0 (2 files): exit 0 · prettier --check: clean</p>`;
}

(async () => {
  const browser = await chromium.launch();
  await shot(browser, '01-central-claim-and-e2e.png', fig1());
  await shot(browser, '02-finding1-stopped-channel-revived.png', fig2());
  await shot(browser, '03-s1-once-per-daemon-and-m1.png', fig3());
  await shot(browser, '04-finding2-masked-and-bystander-stall.png', fig4());
  await shot(browser, '05-patch-red-green-gates.png', fig5());
  await browser.close();
})();
