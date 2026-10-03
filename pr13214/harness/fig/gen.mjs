// Builds the evidence cards from results/*.json and screenshots them with Playwright.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const RIG = '/Users/wenshao/pr13214-rig';
const R = (f) => JSON.parse(fs.readFileSync(`${RIG}/results/${f}.json`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{width:1240px;padding:28px 32px 26px;box-sizing:border-box;background:#0d1117}
h1{font-size:23px;margin:0 0 4px;color:#f0f6fc}
.sub{color:#8b949e;font-size:14.5px;margin:0 0 18px;line-height:1.45}
table{border-collapse:collapse;width:100%;font-size:14.5px;margin:6px 0 14px}
th{background:#161b22;color:#8b949e;text-align:left;font-weight:600;padding:7px 10px;border-bottom:1px solid #30363d}
td{padding:7px 10px;border-bottom:1px solid #21262d;vertical-align:top}
td.n{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:13.2px}
.bad{color:#ff7b72;font-weight:600}.good{color:#3fb950;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:3px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:14px;line-height:1.5;margin-top:8px}
.note.bad{border-color:#f85149;font-weight:400;color:#c9d1d9}.note.good{border-color:#3fb950;font-weight:400;color:#c9d1d9}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 14px;font-family:ui-monospace,Menlo,monospace;font-size:12.8px;line-height:1.45;white-space:pre;overflow:hidden;margin:6px 0 12px;color:#c9d1d9}
.add{color:#3fb950}.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;margin-left:6px}
.t-head{background:#1f6feb33;color:#79c0ff}.t-base{background:#6e768133;color:#c9d1d9}.t-cand{background:#23863633;color:#7ee787}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
h2{font-size:16px;margin:14px 0 4px;color:#f0f6fc}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;
const arm = (a) => `<span class="tag t-${a}">${a}</span>`;
const cards = {};

// 01 race
{
  const rows = [['base', 'race-base-l0', '0 ms'], ['head', 'race-head-l0', '0 ms'], ['cand', 'race-cand-l0', '0 ms'], ['base', 'race-base-l5', '+5 ms / hop'], ['head', 'race-head-l5', '+5 ms / hop']];
  let t = '<table><tr><th>arm</th><th>Broker A ↔ MySQL</th><th>rounds</th><th>contradictions<br><span class="dim">session RELEASED + execution still active</span></th><th>release won<br><span class="dim">admission → runtime_admission_closed</span></th><th>admission won<br><span class="dim">release → 409 runtime_session_busy</span></th><th>worker release calls</th></tr>';
  for (const [a, f, lat] of rows) {
    const s = R(f);
    const k = Object.entries(s.tally);
    const sum = (re) => k.filter(([key]) => re.test(key)).reduce((n, [, v]) => n + v, 0);
    const won = sum(/admit:runtime_admission_closed/);
    const busy = sum(/release:409 runtime_session_busy/);
    t += `<tr><td>${arm(a)}</td><td>${lat}</td><td class="n">${s.rounds}</td><td class="n ${s.contradictions ? 'bad' : 'good'}">${s.contradictions}</td><td class="n">${won}</td><td class="n">${busy}</td><td class="n">${s.workerCalls.control ?? 0}</td></tr>`;
  }
  t += '</table>';
  const sample = R('race-base-l0').samples[0];
  t += `<h2>One base contradiction, as the database holds it afterwards</h2><pre>round ${sample.round}  jitter ${sample.jitter} ms
Broker A  POST /tool-sessions/${sample.sid}:release  → 200 {"released":true}   (worker told to release)
Broker B  admitExecution(${sample.sid})               → ok, ${sample.adm.state}  ${sample.adm.executionCallId.slice(0, 13)}…
MySQL     qwen_runtime_session.session_state = ${sample.after.sessionState}  (version ${sample.after.sessionVersion})
          hasActiveByRuntimeSession           = ${sample.after.hasActive}</pre>`;
  t += `<div class="note">Two independent JVMs over one MySQL 8.4.7 (InnoDB, REPEATABLE-READ). Broker A: production <code>RuntimeBrokerService</code> + HTTP face + real bundled worker (<code>node dist/cli.js managed-runtime-worker</code>). Broker B: the production admission transaction <code>JdbcRuntimeBindingRepository.admitExecution</code> (what <code>createExecution</code> commits). Each round: fresh session, release on A and admission on B fired with random jitter. With latency, A's slower release lets more admissions land first, so head answers 409 more often — every round still ends in exactly one winner.</div>`;
  cards['01-cross-process-race'] = page('Cross-process release vs admission — real MySQL, two Broker JVMs', 'PR #13214 @ af6691ce1f vs merge-base 5130c1a734 · cand = head + 9-line R3-1 fix', t);
}

// 02 R3-1
{
  const get = (f, step) => R(f).find((x) => x.step === step)?.value;
  const rows = [['base', 'r31-base'], ['head', 'r31-head'], ['cand', 'r31-cand']];
  let t = '<table><tr><th>arm</th><th>seeded row</th><th>POST :release</th><th>session after</th><th>execution after</th><th>worker release calls</th></tr>';
  for (const [a, f] of rows) {
    const rel = get(f, 'release');
    const ok = rel.status === 200;
    t += `<tr><td>${arm(a)}</td><td class="mono">RELEASING + PREPARED</td><td class="${ok ? 'bad' : 'good'} mono">${rel.status} ${ok ? 'released=true' : rel.body.code}</td><td class="mono">${get(f, 'after.session').split('\t')[0]}</td><td class="mono">${get(f, 'after.execution')}</td><td class="n">${get(f, 'worker.control.calls.during.release')}</td></tr>`;
  }
  for (const [a, f] of [['head', 'r31-head-noexec'], ['cand', 'r31-cand-noexec']]) {
    const rel = get(f, 'release');
    t += `<tr><td>${arm(a)}</td><td class="mono">RELEASING, nothing active</td><td class="mono good">${rel.status} released=${rel.body.released}</td><td class="mono">${get(f, 'after.session').split('\t')[0]}</td><td class="mono dim">—</td><td class="n">${get(f, 'worker.control.calls.during.release')}</td></tr>`;
  }
  t += '</table>';
  const patch = fs.readFileSync(`${RIG}/candidate-r31.patch`, 'utf8').split('\n');
  const start = patch.findIndex((l) => l.startsWith('@@'));
  const end = patch.findIndex((l, i) => i > start && l.startsWith('diff --git'));
  const hunk = patch.slice(start, end).map((l) => (l.startsWith('+') ? `<span class="add">${esc(l)}</span>` : esc(l))).join('\n');
  t += `<h2>Candidate (bot R3-1's suggestion) — RuntimeBrokerService.transitionSessionToReleasing</h2><pre>${hunk}</pre>`;
  t += `<div class="note bad">Real MySQL + real worker over the HTTP face. The seeded row stands for what a pre-fix (base) peer leaves when its unguarded check-then-act lets an admission in (card 1) and its worker release then fails: RELEASING with the admitted execution still live. Head short-circuits on <code>RELEASING</code> without consulting executions, tells the worker to release and marks the session RELEASED over a live execution; base's unconditional pre-check refused it. The candidate restores the refusal and keeps the idempotent retry (last two rows). Its regression test is red without the 9 lines and green with them; the full module suite on the candidate runs 628 tests with 0 failures (2 skipped), SpotBugs 0, Checkstyle 0, and the 300-round race stays at 0.</div>`;
  cards['02-r31-releasing-retry'] = page('R3-1 confirmed — a release retry over a RELEASING row ignores a live execution', 'Bot round-3 Critical (still open on af6691ce1f) reproduced end to end; candidate fix verified', t);
}

// 03 renewal stall
{
  const series = [['base · 1 stalled row', 'stall-base-s1', '#ff7b72', 22], ['head · 1 stalled row', 'stall-head-s1', '#3fb950', -10], ['head · 2 stalled rows', 'stall-head-s2', '#d29922', -14]];
  const W = 1170, H = 300, L = 70, B = 40, T = 14;
  const xMax = 56, yMin = -22000, yMax = 32000;
  const X = (t) => L + (t / xMax) * (W - L - 20);
  const Y = (v) => T + ((yMax - v) / (yMax - yMin)) * (H - T - B);
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="background:#0d1117">`;
  for (let v = -20000; v <= 30000; v += 10000) svg += `<line x1="${L}" x2="${W - 20}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? '#f85149' : '#21262d'}" stroke-dasharray="${v === 0 ? '5,4' : ''}"/><text x="${L - 8}" y="${Y(v) + 4}" fill="#8b949e" font-size="12" text-anchor="end" font-family="Menlo">${v / 1000}s</text>`;
  for (let t = 0; t <= 55; t += 5) svg += `<text x="${X(t)}" y="${H - 18}" fill="#8b949e" font-size="12" text-anchor="middle" font-family="Menlo">${t}s</text>`;
  svg += `<text x="${L}" y="${H - 2}" fill="#8b949e" font-size="12" font-family="Helvetica">time since dispatch (s)  ·  y = healthy execution's remaining dispatch lease (DB clock); below the red line the lease has lapsed</text>`;
  const outcomes = [];
  for (const [name, f, color, dy] of series) {
    const s = R(f);
    const pts = s.timeline.map((r) => [r.t, Number(r.h2.split('\t')[3])]);
    svg += `<polyline fill="none" stroke="${color}" stroke-width="2.4" points="${pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
    const last = pts.at(-1);
    svg += `<text x="${X(last[0]) - 6}" y="${Y(last[1]) + dy}" fill="${color}" font-size="13" text-anchor="end" font-family="Helvetica" font-weight="600">${name}</text>`;
    outcomes.push([name, s, color]);
  }
  svg += '</svg>';
  let t = svg + '<table><tr><th>run</th><th>record locks held</th><th>stalled execution(s)</th><th>healthy execution (other binding)</th><th>healthy shell actually ran</th></tr>';
  for (const [name, s, color] of outcomes) {
    const stalled = s.stalled.map((h) => s.final[h].split('\t')[0]).join(', ');
    const h2 = s.final.h2.split('\t');
    t += `<tr><td style="color:${color};font-weight:600">${name}</td><td class="n">${s.lockedRows}</td><td class="mono">${stalled}</td><td class="mono ${h2[0] === 'SETTLED' ? 'good' : 'bad'}">${h2[0]}${h2[1] !== '-' ? ' / ' + h2[1] : ''}</td><td class="mono">${s.healthyShellMarker === 'ok' ? 'yes (marker written)' : 'no'}</td></tr>`;
  }
  const ctl = [R('stall-base-s0_ctl'), R('stall-head-s0_ctl')].map((s) => s.final.h2.split('\t').slice(0, 2).join(' / '));
  t += `<tr><td class="dim">control, no lock (base / head)</td><td class="n">0</td><td class="dim">—</td><td class="mono good">${ctl[0]} · ${ctl[1]}</td><td class="mono">yes</td></tr></table>`;
  t += `<div class="note">Three bindings, three real workers, production lease 30 s (renewed every 10 s). A separate MySQL session holds <code>SELECT … FOR UPDATE</code> on the stalled execution's PRIMARY KEY for 45 s (<code>performance_schema.data_locks</code> confirms 1 or 2 record locks), so its dispatch renewal parks in an InnoDB lock wait. Base: the one scheduler thread is parked, the healthy execution's lease is never renewed, and its finished result is discarded as UNKNOWN. Head: renewals keep running on the second pool thread. With two parked renewals the two-thread pool saturates and head behaves like base — the bound the design doc states. Rig deviation: worker request timeout 120 s (production 30 s) so a v2 call can outlive one lease, standing in for long v3 executions.</div>`;
  cards['03-renewal-isolation'] = page('Renewal isolation — one renewal parked in a real InnoDB lock wait', 'Healthy execution on an unrelated binding: base loses it, head keeps it; two parked renewals saturate head\'s pool', t);
}

// 04 startup matrix + lifecycle
{
  const m = { head: R('spring-matrix-head'), base: R('spring-matrix-base') };
  const cell = (r) => {
    if (r.outcome === 'started') return `<span class="mono">listens ${esc(r.listen)}</span>`;
    const c = (r.causes.at(-1) ?? r.reason ?? '').replace(/^Caused by: /, '');
    const short = /refuses a non-loopback/.test(c) ? 'refuses non-loopback listen address'
      : /v3 result window must be at least/.test(c) ? 'v3 result window must be at least PT1S'
      : /not a valid duration/.test(r.reason ?? '') ? "'abc' is not a valid duration"
      : /BindException/.test(c) ? 'BindException (no 127.0.0.2 alias on macOS lo0)'
      : /Unresolved/.test(c) ? 'UnresolvedAddressException' : c.slice(0, 60);
    return `<span class="mono">startup fails: ${esc(short)}</span>`;
  };
  let t = '<h2>Real managed-agent-server startup, documented env names only (broker enabled, MySQL, non-durable local-process)</h2><table><tr><th>env</th><th>head</th><th>base</th></tr>';
  for (let i = 0; i < m.head.length; i++) {
    const h = m.head[i], b = m.base[i];
    const changed = h.outcome !== b.outcome;
    t += `<tr><td class="mono">${esc(h.name)}</td><td class="${changed ? (h.outcome === 'started' ? 'good' : 'warn') : ''}">${cell(h)}</td><td class="${changed ? 'dim' : ''}">${cell(b)}</td></tr>`;
  }
  t += '</table>';
  cards['04-listener-posture'] = page('Listener posture and v3 window — real Spring startup matrix', 'QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST / _ALLOW_NON_LOOPBACK / _V3_RESULT_WINDOW, 12 cases per arm', t
    + '<div class="note">Head refuses 0.0.0.0, the LAN address and an unresolved name at startup with an actionable message, and opts back in only with ALLOW_NON_LOOPBACK=true. localhost and ::1 still start. A suffix-less V3_RESULT_WINDOW (bound as milliseconds) now fails startup; 45m (above the TS client\'s fixed 30-minute v3 deadline, bot R3-4) is still accepted.</div>');
}

// 05 lifecycle + drain + polling
{
  const lc = (a, k) => R(`lifecycle-${a}-${k}`);
  const le = (a, k) => R(`libexit-${a}-${k}`);
  const fmt = (s) => (s.workerGoneAt != null ? `gone +${(s.workerGoneAt - s.signalAt).toFixed(1)} s` : 'survives Broker exit');
  let t = '<div class="grid"><div><h2>Worker after the Broker exits (real worker, non-durable)</h2><table><tr><th>case</th><th>head</th><th>base</th></tr>';
  const rows = [['Spring SIGTERM · healthy worker', 'healthy'], ['Spring SIGTERM · worker frozen (SIGSTOP)', 'wedged'], ['Spring SIGTERM · worker in ready handshake', 'handshake'], ['Spring SIGKILL · healthy worker', 'sigkill']];
  for (const [name, k] of rows) {
    const h = lc('head', k), b = lc('base', k);
    t += `<tr><td>${name}</td><td class="mono ${h.workerGoneAt != null ? 'good' : 'warn'}">${fmt(h)}</td><td class="mono ${b.workerGoneAt != null ? '' : 'bad'}">${fmt(b)}</td></tr>`;
  }
  for (const [name, k] of [['library JVM SIGTERM (no close) · healthy', 'healthy'], ['library JVM SIGTERM (no close) · handshake', 'handshake']]) {
    const h = le('head', k), b = le('base', k);
    t += `<tr><td>${name}</td><td class="mono good">gone +${(h.goneAfterMs / 1000).toFixed(1)} s</td><td class="mono bad">${b.later?.[0] === 'gone' ? 'outlives JVM, dies ~22 s later' : 'orphaned (ppid 1)'}</td></tr>`;
  }
  const orphans = fs.readFileSync(`${RIG}/results/orphans-after-sigterm.txt`, 'utf8').trim().split('\n').filter(Boolean);
  t += `<tr><td>orphaned workers found after all rig runs (Broker JVMs stopped with SIGTERM)</td><td class="mono good">${orphans.filter((l) => l.includes('pr13214-head')).length}</td><td class="mono bad">${orphans.filter((l) => l.includes('pr13214-base')).length}</td></tr></table></div>`;
  const lb = R('lost-base-303'), lh = R('lost-head-303');
  t += '<div><h2>LOST reclaim after a simulated power loss (303 sessions)</h2><table><tr><th>arm</th><th>warm #</th><th>answer</th><th>generation-1 sessions after</th></tr>';
  for (const [a, s] of [['base', lb], ['head', lh]]) for (const w of s.warms) t += `<tr><td>${arm(a)}</td><td class="n">${w.attempt}</td><td class="mono ${w.status === 200 ? 'good' : 'bad'}">${w.status} ${w.code}</td><td class="mono">${w.sessions.replace(/1:/g, '')}</td></tr>`;
  t += '</table>';
  const ph = R('poll-head'), pb = R('poll-base');
  t += `<h2>UNKNOWN polling by the shipped TS client (20 s window)</h2><table><tr><th>client path</th><th>head: GETs / worker status</th><th>base: GETs / worker status</th></tr>
<tr><td>MCP session: <code>execute(…, waitForUnknown=true)</code> → <code>?reconcile=true</code> every 250 ms</td><td class="mono warn">${Object.values(ph.mcpSession.clientRequests).at(-1)} / ${ph.mcpSession.workerCalls.status}</td><td class="mono">${Object.values(pb.mcpSession.clientRequests).at(-1)} / ${pb.mcpSession.workerCalls.status}</td></tr>
<tr><td>non-MCP session: plain GET, stops at first UNKNOWN</td><td class="mono">1 / ${ph.plainSession.workerCalls.status ?? 0}</td><td class="mono">1 / ${pb.plainSession.workerCalls.status ?? 0}</td></tr>
<tr><td>20 rapid plain GETs on the same v2 UNKNOWN</td><td class="mono">20 / ${ph.rapidPlainGets.workerStatusCalls}</td><td class="mono">20 / ${pb.rapidPlainGets.workerStatusCalls}</td></tr></table></div></div>`;
  t += '<div class="note">Head reaps a frozen worker after the 5 s grace and covers workers still in their handshake; a SIGKILLed Broker cannot run any hook on either arm. The drain loop turns base\'s 503 at 300 sessions into one warm (needs stop evidence: trusted reboot recovery on the production durable store, host identity injected as the fault gates do on macOS). The 1 s cooldown never engages for the shipped client: the only path that polls an UNKNOWN repeatedly sends <code>reconcile=true</code>, which bypasses it by design (bot R3-3) — worker status traffic is unchanged.</div>';
  cards['05-lifecycle-drain-polling'] = page('Worker shutdown, LOST drain, UNKNOWN polling — real stack', 'Spring managed-agent-server and library-embedded Broker JVMs, real bundled worker, MySQL 8.4.7', t);
}

const require = createRequire('/Users/wenshao/git/qwen-code-x9/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
for (const [name, html] of Object.entries(cards)) {
  const file = `${RIG}/fig/${name}.html`;
  fs.writeFileSync(file, html);
  const p = await ctx.newPage();
  await p.goto('file://' + file);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log(name, 'clipped elements:', clipped);
  await p.close();
}
await browser.close();
