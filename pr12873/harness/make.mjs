// Builds the evidence cards for the PR #12873 verification report.
import fs from 'node:fs';
import path from 'node:path';

const SP = '$RIG';
const OUT = path.join(SP, 'figures');
const log = (name) => fs.readFileSync(path.join(SP, 'logs', name), 'utf8');

const css = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mute:#8b949e;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--acc:#58a6ff;--pur:#bc8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.card{width:1400px;padding:28px 32px 26px}
h1{font-size:23px;margin:0 0 4px;font-weight:650}
.sub{color:var(--mute);font-size:14px;margin-bottom:18px}
table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:14px}
th{color:var(--mute);font-weight:600;background:#11161d;font-size:13px}
tr:last-child td{border-bottom:none}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}.warn{color:var(--warn);font-weight:600}.acc{color:var(--acc)}.mute{color:var(--mute)}.pur{color:var(--pur)}
.note{margin-top:14px;border-left:3px solid var(--acc);padding:6px 12px;color:#c9d1d9;background:#0f1620;font-size:14px}
.note.warn{border-color:var(--warn)}.note.bad{border-color:var(--bad)}.note.ok{border-color:var(--ok)}
pre{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px;white-space:pre;overflow:hidden;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.label{color:var(--mute);font-size:12.5px;margin:0 0 5px}
td:nth-child(6){white-space:nowrap}.pill{display:inline-block;padding:0 7px;border-radius:10px;font-size:12px;font-weight:600;border:1px solid}
.pill.ok{border-color:#238636;background:#0f2a17}.pill.bad{border-color:#8e1519;background:#2d0f12}.pill.warn{border-color:#9e6a03;background:#2b1d05}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}</div></body></html>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Figure 1: the PR gate on a real stack + base-arm A/B ----------
const fg = (text, c) => {
  const m = text.match(new RegExp(`FG6A ${c}: drops=(\\d+), modelCalls=(\\d+), starts=(\\d+), blocked=(\\w+)`));
  return m ? { drops: m[1], model: m[2], starts: m[3], blocked: m[4] } : undefined;
};
const cases = ['acquire', 'prepare', 'prepare-twice', 'start', 'status', 'cancel', 'release', 'release-before-forward'];
const mysql = log('it-ci-mysql847.log');
const maria = log('it-wt-mariadb.log');
const ledger = log('it-ledger-mysql.log');
const ci = fs.readFileSync(path.join(SP, 'ci-hosted.log'), 'utf8');
const ownerHeld = { acquire: 'held', prepare: 'released', 'prepare-twice': 'held', start: 'released', status: 'held', cancel: 'held', release: 'released', 'release-before-forward': 'held' };
const rows1 = cases.map((c) => {
  const a = fg(mysql, c), b = fg(maria, c), k = fg(ci, c);
  const row = ledger.match(new RegExp(`FG6A_LEDGER ${c} as \\S+ rows=\\[(.*)\\]`))?.[1] ?? '';
  const sql = row ? row.replace(/execution_call_id=[^,]+, /, '').replace(/dispatch_generation=/, 'gen=').replace(/execution_state=/, '').replace(/execution_status=/, '').replace(/[{}]/g, '') : '<span class="mute">no reservation</span>';
  const base = log(`it-base-${c}.log`);
  const baseOk = base.includes('HOSTED_REPLY_LOSS_OK');
  const baseWhy = baseOk ? '' : base.includes('fault did not fire') ? 'only 1 prepare sent — “fault did not fire”' : /recovery blocked: TypeError: fetch failed/.test(base) ? 'recoveryBlocked=true (expected false) — “recovery blocked: TypeError: fetch failed”' : 'failed';
  const same = (x) => x && a && x.drops === a.drops && x.model === a.model && x.starts === a.starts && x.blocked === a.blocked;
  const cell = (x) => (x ? `<span class="${same(x) ? 'ok' : 'bad'}">✓</span> <span class="mono">${x.drops}/${x.model}/${x.starts}/${x.blocked === 'true' ? '<span class="warn">blocked</span>' : 'recovered'}</span>` : '<span class="bad">missing</span>');
  return `<tr><td class="mono">${c}</td><td>${cell(a)}</td><td>${cell(b)}</td><td>${cell(k)}</td><td class="mono">${sql}</td><td class="mono">${ownerHeld[c]}</td><td>${baseOk ? '<span class="pill ok">pass</span> <span class="mute">(pre-existing behaviour)</span>' : `<span class="pill bad">FAIL</span> <span class="mono">${esc(baseWhy)}</span>`}</td></tr>`;
}).join('');
const unitLine = mysql.match(/Tests run: 137, Failures: 0, Errors: 0, Skipped: 0/) ? '137/137' : '?';
const reps = [1, 2, 3, 4, 5].map((i) => log(`it-repeat-mysql-${i}.log`).match(/Tests run: 2, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s/)?.[1]);
const repsM = [1, 2, 3].map((i) => log(`it-repeat-mariadb-${i}.log`).match(/Tests run: 2, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s/)?.[1]);
fs.writeFileSync(path.join(OUT, '01.html'), page(
  'PR #12873 FG6a gate on a real stack — PR head vs base',
  `Head <code>69fd6c29</code> · packaged <code>dist/cli.js</code> Harness + Spring Session Store + embedded Runtime Broker + real worker · deterministic fake model (the PR's own driver) · cell = drops / model calls / starts / outcome`,
  `<table><tr><th>fault case</th><th>PR · MySQL 8.4.7 (local)</th><th>PR · MariaDB 10.11.18 (local)</th><th>PR · CI MySQL 8.4.6 (job 108676258477)</th><th>SQL ledger (MySQL)</th><th>storage owner</th><th>BASE client (3f5ae3ff) · same gate</th></tr>${rows1}</table>
  <div class="grid2"><div class="note ok">CI-equivalent command (<code>-Phosted-harness-mysql clean verify checkstyle:check</code>): Java unit ${unitLine}, <code>HostedWorkspaceToolTurnIT</code> 2/2, <code>HostedHarnessMySqlIT</code> 1/1, Checkstyle — 38 s on MySQL 8.4.7. MariaDB via <code>-Phosted-workspace-tools</code>: 137 + 2/2 in 43 s. Stability: 5× MySQL (${reps.join(', ')} s) and 3× MariaDB (${repsM.join(', ')} s), all green. Trial merge with main <code>0a136f89</code> (#12864) + its new <code>check-failsafe-reports.js hosted</code> step: green.</div>
  <div class="note warn">Base arm = only <code>hosted-workspace-broker.ts</code> swapped back to the merge base and re-bundled. Six rows pass on base: they pin behaviour that already existed. Only the two prepare rows exercise the new retry — on base a single lost prepare reply leaves the Session <b>recovery-blocked forever</b> with its reservation PREPARED and the Workspace storage owner held.</div></div>`));

// ---------- Figure 2: probes the PR gate does not contain ----------
const probe = (file) => [...log(file).matchAll(/PROBE_SUMMARY (\{.*\})/g)].map((m) => JSON.parse(m[1]));
const probes = [...probe('it-probe-fast.log'), ...probe('it-probe-slow.log')];
const led2 = log('it-probe-fast.log') + log('it-probe-slow.log');
const what = {
  'prepare-timeout': ['Broker applies prepare; proxy holds the reply > 30 s', '<code>DOMException TimeoutError</code> after 29,989 ms → retry'],
  'prepare-truncated': ['Broker applies prepare; half the body, then socket reset', '<code>TypeError: terminated</code> (mid-body) → retry'],
  'prepare-request-lost': ['first request dropped before it reaches the Broker', '<code>TypeError: fetch failed</code> → retry creates it'],
  'prepare-late-original': ['first request held 30 s, delivered to the Broker <i>after</i> the retry', 'retry wins; stale original gets the <b>same</b> executionCallId'],
  'prepare-gateway-502': ['Broker applies prepare; an intermediary answers 502 text/html', '<code>SyntaxError</code> → not a transport failure → no retry'],
  'prepare-gateway-504j': ['Broker applies prepare; an intermediary answers 504 JSON', '<code>HostedWorkspaceBrokerRejection(504)</code> → no retry'],
};
const order = Object.keys(what);
const rows2 = order.map((f) => {
  const s = probes.find((p) => p.fault === f);
  const row = led2.match(new RegExp(`FG6A_LEDGER ${f} as \\S+ rows=\\[(.*?)\\]\\n`))?.[1] ?? '';
  const sql = row.replace(/execution_call_id=[^,]+, /, '').replace(/dispatch_generation=/, 'gen=').replace(/execution_state=/, '').replace(/execution_status=/, '').replace(/[{}]/g, '');
  const prepReq = s.exchanges.filter((e) => e.operation === 'prepare').length;
  return `<tr><td class="mono">${f}</td><td>${what[f][0]}</td><td>${what[f][1]}</td><td class="mono">${prepReq} / ${s.distinctExecutionIds.length}</td><td class="mono">${s.starts}</td><td>${s.recoveryBlocked ? '<span class="warn">blocked</span>' : '<span class="ok">recovered</span>'} <span class="mute mono">${(s.turnMs / 1000).toFixed(1)} s</span></td><td class="mono">${sql}</td><td class="mono">${s.file}</td></tr>`;
}).join('');
const late = probes.find((p) => p.fault === 'prepare-late-original');
const tmo = probes.find((p) => p.fault === 'prepare-timeout');
const tl = (s) => {
  const t0 = s.exchanges[0].at;
  return s.exchanges.map((e) => `${String(e.at - t0).padStart(6)} ms  ${e.operation.padEnd(8)} requestId ${String(e.requestId).slice(0, 8)}  ${e.operation === 'prepare' ? 'idempotencyKey …' + String(e.idempotencyKey ?? '').slice(-12) : ''.padEnd(28)}  executionCallId ${String(e.executionCallId ?? '—').slice(0, 8).padEnd(8)}  ${(e.state ?? '').padEnd(9)} ${(e.note ?? '').replace(/^original held; client closed at \d+ ms$/, 'held at the proxy since it arrived; Harness timed out here')}`).join('\n');
};
fs.writeFileSync(path.join(OUT, '02.html'), page(
  'Beyond the PR gate — six prepare faults it does not exercise (same real stack, MySQL 8.4.7)',
  'Verification-only probe driver on the PR\'s own IT scaffolding; SQL row = the only <code>qwen_tool_execution</code> row of that Session (the IT\'s ledger assertions ran on every probe)',
  `<table><tr><th>probe</th><th>what the proxy does</th><th>what the Harness sees</th><th>prepare req / ids</th><th>starts</th><th>outcome</th><th>SQL ledger</th><th>file</th></tr>${rows2}</table>
  <div style="margin-top:14px"><div class="label">prepare-timeout — Broker traffic at the proxy (the retry fires on the timeout branch)</div><pre>${esc(tl(tmo))}</pre></div>
  <div style="margin-top:12px"><div class="label">prepare-late-original — the stale original reaches the Broker after the retry and gets the same executionCallId</div><pre>${esc(tl(late))}</pre></div>
  <div class="grid2"><div class="note ok">Every recovered probe: one reservation, dispatch generation 1, one physical edit (<code>x → xx</code>), release confirmed, reload does not replay Broker work. The timeout branch of the retry predicate works on Node 22 — but no test in the PR reaches it (see mutation card).</div>
  <div class="note warn">Only transport failures are retried. If a gateway sits between Harness and Broker and turns a lost upstream reply into 502/504, the Session blocks with the reservation PREPARED and the storage owner held — safe (never replays), but not recovered. Consistent with the PR's "definite or invalid replies are not retried".</div></div>`));

// ---------- Figure 3: real model ----------
const real = (file) => [...log(file).matchAll(/REAL_SUMMARY (\{.*\})/g)].map((m) => JSON.parse(m[1]));
const pr = real('it-real-model-1.log');
const base = real('it-real-model-base.log')[0];
const realTl = (s) => {
  const first = s.exchanges[0].at;
  const lines = s.exchanges.map((e) => `${String(e.at - first).padStart(6)} ms  ${e.operation.padEnd(8)} req ${String(e.requestId).slice(0, 8)}  exec ${String(e.executionCallId ?? '—').slice(0, 8).padEnd(8)}  ${(e.state ?? '').padEnd(9)}${e.lost ? ' ← REPLY LOST' : ''}`);
  return lines.join('\n');
};
const lastText = (s) => s.modelCalls.at(-1)?.text?.replace(/\\n/g, ' ') ?? '';
// the per-session modelCalls list is cumulative in the driver; take the tail belonging to trial 2
const trial2Calls = pr[1].modelCalls.slice(pr[0].modelCalls.length);
fs.writeFileSync(path.join(OUT, '03.html'), page(
  'Real model (qwen3.8-max) — first reply of every prepare lost after the Broker applied it',
  'Same packaged Harness / Spring / Broker / worker / MySQL 8.4.7; the fixture model replaced by a local relay to the real provider. Prompt: one <code>edit</code> call, <code>x → xx</code>, replace_all.',
  `<table><tr><th>arm</th><th>model tool calls</th><th>prepare requests / reservations</th><th>starts</th><th>Session</th><th>terminal</th><th>file</th><th>SQL ledger</th><th>model's final answer</th></tr>
  <tr><td>PR · trial 1</td><td class="mono">edit</td><td class="mono">2 / 1</td><td class="mono">${pr[0].starts}</td><td class="ok">recovered</td><td class="mono">${pr[0].terminal}</td><td class="mono">${pr[0].file}</td><td class="mono">gen=1 SETTLED success</td><td>${esc(lastText(pr[0]))}</td></tr>
  <tr><td>PR · trial 2</td><td class="mono">edit</td><td class="mono">2 / 1</td><td class="mono">${pr[1].starts}</td><td class="ok">recovered</td><td class="mono">${pr[1].terminal}</td><td class="mono">${pr[1].file}</td><td class="mono">gen=1 SETTLED success</td><td>${esc(trial2Calls.at(-1)?.text ?? '')}</td></tr>
  <tr><td>BASE client</td><td class="mono">edit</td><td class="mono">1 / 1</td><td class="mono">${base.starts}</td><td class="bad">recovery-blocked</td><td class="mono">—</td><td class="mono">${base.file}</td><td class="mono">gen=0 PREPARED · owner held · Runtime Session READY</td><td class="mute">(never asked again — the turn never continues)</td></tr></table>
  <div class="grid2"><div><div class="label">PR · trial 1 — Broker traffic seen by the proxy</div><pre>${esc(realTl(pr[0]))}</pre></div>
  <div><div class="label">BASE — same fault</div><pre>${esc(realTl(base))}\n\nHarness log: recovery blocked: TypeError: fetch failed\n(no start, no release, no second model call)</pre></div></div>
  <div class="note ok">With the PR the lost prepare reply is invisible to the model: the retry leaves 5–6 ms after the loss with the same idempotency key, the Broker answers with the same <code>executionCallId</code>, the edit runs once, and the model continues. On the base client the same single loss wedges the Session and keeps the Workspace storage owned.</div>`));

// ---------- Figure 4: mutation matrix ----------
const M = [
  ['T1', 'base client — no prepare retry', 'KILLED · prepare: blocked; prepare-twice: “fault did not fire”', 'KILLED · 2 of 16 fail', '—'],
  ['T2', 'retry only on <code>TypeError</code> (timeout branch removed)', 'SURVIVED · all 8 cases pass', 'SURVIVED · 16/16 pass', 'KILLED · prepare-timeout probe: “recovery blocked: TimeoutError”; candidate unit test fails'],
  ['T3', 'retry only on <code>TimeoutError</code> (TypeError branch removed)', 'KILLED · prepare blocked', 'KILLED · 2 of 16 fail', '—'],
  ['T4', 'retry with a new idempotency key', 'KILLED · orphan reservation → release 409 <code>runtime_session_busy</code>', 'KILLED · 1 of 16 fail', '—'],
  ['T5', 'retry on any error (incl. 409/503/invalid)', 'SURVIVED · all 8 cases pass', 'KILLED · 3 of 16 fail', '—'],
  ['T6', 'three attempts instead of two', 'KILLED · prepare-twice drops 3 ≠ 2', 'KILLED · 1 of 16 fail', '—'],
  ['T7', 'status poll retries a lost GET instead of blocking', 'KILLED · status row expects blocked', 'SURVIVED · 16/16 pass', 'pins the conservative contract (see note 3)'],
  ['J1', 'Broker: repeated idempotency key → conflict (non-idempotent prepare)', 'KILLED · retry gets 409 <code>runtime_execution_conflict</code>', 'n/a', '—'],
  ['J2', 'Broker: release keeps the Workspace storage owner', 'KILLED by the Java SQL ledger only (“prepare released owner”) — the TS driver still printed OK', 'n/a', '—'],
];
const cls = (t) => (t.startsWith('KILLED') ? 'ok' : t.startsWith('SURVIVED') ? 'bad' : 'mute');
const rows4 = M.map(([id, desc, gate, unit, extra]) => `<tr><td class="mono">${id}</td><td>${desc}</td><td class="${cls(gate)}">${gate}</td><td class="${cls(unit)}">${unit}</td><td class="${cls(extra)}">${extra}</td></tr>`).join('');
fs.writeFileSync(path.join(OUT, '04.html'), page(
  'Independent mutation run — 9 mutants (7 TypeScript on the bundle, 2 Java on the Broker/Store)',
  'Each mutant: rebuild the bundle (or the Java module), run the PR\'s 8-case gate on MySQL 8.4.7 and the 16 broker unit tests; sources restored and the bundle re-verified byte-identical afterwards',
  `<table><tr><th>id</th><th>mutation</th><th>PR gate (8 cases, real stack)</th><th>PR unit tests</th><th>my probe / candidate test</th></tr>${rows4}</table>
  <div class="grid2"><div class="note warn"><b>T2 is the only mutant no PR test detects.</b> The <code>TimeoutError</code> half of the retry predicate is correct (probe: 29,989 ms → retry → same reservation) but untested. Candidate: one 37-line unit test that makes the first <code>fetch</code> reach the Broker and then reject with <code>DOMException('…', 'TimeoutError')</code> — passes on 69fd6c29 (17/17), fails on T2.</div>
  <div class="note ok">The gate's two layers both earn their place: T5 is caught only by the unit tests, T7 only by the real-stack gate, and J2 only by the Java SQL-ledger assertions — the TypeScript driver cannot see a storage owner that was never cleared.</div></div>`));
console.log('ok');
