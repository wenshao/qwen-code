import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const S2 = '/Users/wenshao/pr13350-rig/out/s2';
const E2E = '/Users/wenshao/pr13350-rig/out/e2e';
const R = (l) => JSON.parse(readFileSync(`${S2}/${l}-result.json`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (b) => ((/"code":"([a-z_]+)"/.exec(b || '') || [])[1] || '');
const short = { hosted_session_already_attached: 'A', hosted_turn_recovery_required: 'R' };
function loadSeq(r) {
  const toks = r.loadReplies.map((l) => (l.dropped ? '200✂' : l.status === null ? 'timeout' : l.status === 200 ? '200' : `${l.status}${short[code(l.body)] ?? ':' + code(l.body)}`));
  const out = [];
  for (const t of toks) { const last = out.at(-1); if (last && last.t === t) last.n++; else out.push({ t, n: 1 }); }
  return out.map((x) => (x.n > 1 ? `${x.t}×${x.n}` : x.t)).join(' → ');
}
function cell(label) {
  const r = R(label);
  const ok = r.terminal.startsWith('turn.');
  const lease = r.after.lease === 'NULL\tNULL' ? 'lease freed' : 'Workspace lease still held';
  const second = r.secondSessionOnSameWorkspace ? (r.secondSessionOnSameWorkspace.terminal === 'turn.completed' ? '2nd Session ✓' : '2nd Session ✗') : '';
  const status = ok ? `${r.terminal.replace('turn.', '')} ${(r.msReplacementReadyToTerminal / 1000).toFixed(1)} s` : `${r.after.turn[0]} after ${Math.round(+r.terminal.match(/\d+/)[0] / 1000)} s`;
  return { ok, html: `<div class="seq">${esc(loadSeq(r))}</div><div class="${ok ? 'good' : 'bad'}">${esc(status)}</div><div class="dim">${esc([lease, second].filter(Boolean).join(' · '))}</div>` };
}
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px 22px;background:#0d1117;min-width:1100px;max-width:1440px}
h1{font-size:23px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:14px;margin-bottom:16px}
table{border-collapse:collapse;font-size:13.5px}
th{color:#8b949e;font-weight:600;text-align:left;padding:7px 12px;border-bottom:1px solid #30363d;white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid #21262d;vertical-align:top}
td.sc{color:#c9d1d9;width:300px}
.seq{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:#c9d1d9;white-space:nowrap}
.good{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.dim{color:#8b949e;font-size:12.5px}
.na{color:#484f58}
.note{border-left:3px solid #388bfd;padding:6px 12px;margin-top:14px;color:#c9d1d9;font-size:13.5px;line-height:1.5;max-width:1360px}
.note.warn{border-color:#d29922}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.5;margin:0;white-space:pre;color:#c9d1d9}
.cols{display:flex;gap:18px}.col{flex:1;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px;min-width:0}
.col h2{font-size:15px;margin:0 0 8px}
.g{color:#3fb950}.r{color:#f85149}.y{color:#d29922}.b{color:#58a6ff}.m{color:#8b949e}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}</div></body></html>`;

// ---------- 01 matrix ----------
const rows = [
  ['Continuation takeover — first load reply dropped', 'continuation-drop-load-reply'],
  ['In-flight takeover (replacement runs the tool) — first load reply dropped', 'inflight-drop-load-reply'],
  ['Cancellation (passive) takeover, in-flight — first load reply dropped', 'inflight-db-cancel-drop-load-reply'],
  ['Cancellation (passive) takeover, continuation — first load reply dropped', 'continuation-db-cancel-drop-load-reply'],
  ['Slow first load, no proxy fault (coordinator timeout 10 s, execute held 15 s)', 'inflight-slow-load'],
  ['Transient 503 on the redrive\'s Broker re-acquire — continuation', 'acqfail-continuation-drop-load-reply', true],
  ['Transient 503 on the redrive\'s Broker re-acquire — in-flight', 'acqfail-inflight-drop-load-reply', true],
  ['Control: takeover without faults — continuation', 'continuation-none'],
  ['Control: takeover without faults — in-flight', 'inflight-none'],
];
let t = '<table><tr><th>Scenario (real packaged stack)</th><th>base 5ddfacc</th><th>head f060289</th><th>head + main 2c591ec</th><th>mutant: acquire-branch guard removed</th></tr>';
for (const [name, key, mut] of rows) {
  t += `<tr><td class="sc">${esc(name)}</td>`;
  for (const arm of ['base', 'head', 'merge', 'mut']) {
    let label;
    if (key.startsWith('acqfail-')) label = arm === 'base' ? null : `${arm}-${key}`;
    else label = arm === 'mut' ? null : `${arm}-${key}`;
    if (!label || !existsSync(`${S2}/${label}-result.json`)) { t += `<td class="na">${arm === 'base' && key.startsWith('acqfail-') ? 'n/a (wedges before the redrive)' : '—'}</td>`; continue; }
    t += `<td>${cell(label).html}</td>`;
  }
  t += '</tr>';
}
t += '</table>';
t += `<div class="note">Load ledger = what the replacement coordinator (Spring) got back from Harness B, in order. <b>200✂</b> = the Harness attached and answered 200, the tap cut the reply. <b>409A</b> = <code>hosted_session_already_attached</code>, <b>409R</b> = <code>hosted_turn_recovery_required</code> (retry-inviting), <b>timeout</b> = the coordinator's 10 s request timeout fired. MySQL 8.0.46 · JDK 21 · Spring fat jar 26f2ae3c · embedded Runtime Broker + durable local worker · Linux aarch64 container.</div>`;
writeFileSync('/Users/wenshao/pr13350-rig/fig/01-ab-matrix.html', page('PR #13350 — takeover load after a lost reply: A/B on the real stack', 'Owner A crashes with a parked tool Turn; owner B (Spring + Hosted Harness + Broker) takes it over. One run per cell; every head / merge cell also ran in the probe batches below with the same outcome.', t));

// ---------- 02 wire ledger ----------
function ledger(label) {
  const r = R(label);
  const t0 = r.loadReplies.find((l) => l.dropped).t;
  const lines = [];
  for (const l of r.coordinatorToHarnessB) {
    const m = /^(\d+)ms (.*)$/.exec(l); if (!m || / GET /.test(m[2]) && !/events/.test(m[2])) continue;
    lines.push([+m[1] - t0, 'C', m[2]]);
  }
  for (const l of r.harnessBToBroker) { const m = /^(\d+)ms (.*)$/.exec(l); if (m) lines.push([+m[1] - t0, 'B', m[2]]); }
  lines.sort((a, b) => a[0] - b[0]);
  const fmt = ([dt, who, s]) => {
    s = s.replace(/\/session\/[0-9a-f-]+/, '/session/:id').replace(/\/internal\/runtime-broker\/v1/, '').replace(/tool-sessions\/[0-9a-f-]+/, 'tool-sessions/:rs').replace(/executions\/[0-9a-f-]+[^ ]*/, 'executions/:x');
    const m = /^(\S+) (\S+) #\d+ -> (.*)$/.exec(s);
    if (!m) return `<span class="m">${esc(s.slice(0, 90))}</span>`;
    let res = m[3];
    let cls = 'g';
    if (/^upstream 200/.test(res)) { res = '200 (reply cut by tap)'; cls = 'y'; }
    else if (/^409/.test(res)) { res = `409 ${code(res).replace(/^hosted_session_/, '')}`; cls = 'r'; }
    else if (/sse open/.test(res)) res = '200 (SSE open)';
    else res = res.slice(0, 3);
    const who2 = who === 'C' ? 'coord→harness' : 'harness→broker';
    return `<span class="m">${String((dt / 1000).toFixed(1)).padStart(6)} s</span>  <span class="b">${who2.padEnd(14)}</span> ${esc((m[1] + ' ' + m[2]).padEnd(43))} <span class="${cls}">${esc(res)}</span>`;
  };
  const final = `\n<span class="m">turn</span>   ${r.after.turn[0] === 'COMPLETED' ? '<span class="g">COMPLETED</span>' : `<span class="r">${r.after.turn[0]}</span>`}  <span class="m">public text</span> ${esc(JSON.stringify(r.after.publicText))}\n<span class="m">lease</span>  ${r.after.lease === 'NULL\tNULL' ? '<span class="g">released</span>' : '<span class="r">held by ' + esc(r.after.lease.split('\t')[1].slice(0, 8)) + '… (Workspace pinned)</span>'}\n<span class="m">tool</span>   ${esc(r.after.executions.map((e) => `${e[1]} dispatch_generation=${e[2]}`).join(', '))}\n<span class="m">2nd Session on the Workspace</span> ${r.secondSessionOnSameWorkspace ? '<span class="g">' + esc(r.secondSessionOnSameWorkspace.terminal) + '</span>' : '<span class="r">not reachable (Turn never settled)</span>'}`;
  return lines.map(fmt).join('\n') + '\n' + final;
}
const l2 = `<div class="cols"><div class="col"><h2 class="r">base 5ddfacc — wedged</h2><pre>${ledger('base-continuation-drop-load-reply')}</pre></div><div class="col"><h2 class="g">head f060289 — recovered</h2><pre>${ledger('head-continuation-drop-load-reply')}</pre></div></div>
<div class="note">Times are relative to the attached-but-lost first load. On head the redrive re-runs recovery (the parked tool is already settled, so it is the acquire-only branch): one more <code>tool-sessions:acquire</code> → 200 with the <b>same</b> runtimeSessionId and binding id/generation as the first load, then the coordinator admits <code>continue</code> and opens the stream. Nothing executes twice (tool row stays SETTLED, generation 1, zero file-system events after the crash).</div>`;
writeFileSync('/Users/wenshao/pr13350-rig/fig/02-wire-ledger.html', page('Continuation takeover with the first load reply dropped — wire ledger', 'Same scenario on both arms: coordinator→Harness B traffic (tap) and Harness B→Runtime Broker traffic (tap), plus the durable state afterwards.', l2));

// ---------- 03 held-lease guard ----------
function brokerTimeline(label) {
  const r = R(label);
  const t0 = r.loadReplies.find((l) => l.dropped).t;
  const items = [];
  for (const l of r.loadReplies) items.push([l.t - t0, 'coord→harness', 'POST /load', l.dropped ? ['y', '200 (reply cut)'] : l.status === 200 ? ['g', '200'] : ['r', `${l.status} ${code(l.body)}`]]);
  for (const l of r.harnessBToBroker) {
    const m = /^(\d+)ms (?:POST|GET) \/internal\/runtime-broker\/v1\/(\S+) #\d+ -> (.*)$/.exec(l); if (!m) continue;
    if (/warm|control|executions/.test(m[2])) continue;
    const p = m[2].replace(/tool-sessions\/[0-9a-f-]+/, 'tool-sessions/:rs');
    const res = /^injected/.test(m[3]) ? ['y', '503 injected (transient)'] : /^409/.test(m[3]) ? ['r', '409 ' + code(m[3])] : ['g', m[3].slice(0, 3)];
    items.push([+m[1] - t0, 'harness→broker', p, res]);
  }
  items.sort((a, b) => a[0] - b[0]);
  const lines = items.slice(0, 16).map(([dt, who, p, [c, s]]) => `<span class="m">${(dt / 1000).toFixed(1).padStart(6)} s</span>  <span class="b">${who.padEnd(14)}</span> ${esc(p.padEnd(30))} <span class="${c}">${esc(s)}</span>`);
  const ok = r.terminal.startsWith('turn.');
  lines.push('', `<span class="m">turn</span> ${ok ? '<span class="g">' + r.after.turn[0] + '</span>' : '<span class="r">' + r.after.turn[0] + ' (no terminal event in 75 s)</span>'}`);
  return lines.join('\n');
}
const l3 = `<div class="cols"><div class="col"><h2 class="g">head f060289 — guard keeps the held lease</h2><pre>${brokerTimeline('head-acqfail-continuation-drop-load-reply')}</pre></div><div class="col"><h2 class="r">mutant — <code>if (!input.leaseAlreadyHeld)</code> → <code>if (true)</code> in the acquire-only catch</h2><pre>${brokerTimeline('mut-acqfail-continuation-drop-load-reply')}</pre></div></div>
<div class="note">The second <code>tool-sessions:acquire</code> (the redrive's re-acquire) is answered 503 once by the tap. Head refuses that redrive with the retry-inviting 409R, keeps the lease, and the next redrive re-acquires (200, same identity) and finishes. Without the guard, the failure exit calls <code>:release</code>; the real Broker persists RELEASED and refuses every later acquire of that identity with <code>409 runtime_session_not_acquirable</code> — the Turn is wedged again, now on 409R. The in-flight variant behaves the same: head and merge recover in both variants (4/4 runs), the mutant wedges in both (2/2 runs).</div>`;
writeFileSync('/Users/wenshao/pr13350-rig/fig/03-held-lease-guard.html', page('leaseAlreadyHeld against the real Runtime Broker', 'Continuation takeover, first load reply dropped, then one transient failure on the redrive\'s Broker re-acquire.', l3));
console.log('ok');

// ---------- 04 probes ----------
{
  const P = (l) => R(l).probe;
  const row = (label) => {
    const p = P(label);
    const conc = p.concurrentRedrives.map((c) => `${c.status}${c.identicalToDropped ? '=' : ''}`).join(' ');
    return `${label.replace(/-drop-load-reply/, '').padEnd(28)} <span class="${p.concurrentRedrives.every((c) => c.status === 200) ? 'g' : 'r'}">${esc(conc.padEnd(14))}</span> +${p.acquiresAfterProbe - 1} acquire  :start=${p.startsAfterProbe}   plain <span class="${p.plainLoad.status === 409 ? 'g' : 'r'}">${p.plainLoad.status}</span>  create <span class="${p.create.status === 409 ? 'g' : 'r'}">${p.create.status}</span>`;
  };
  const probeRows = ['base-probe-continuation-drop-load-reply', 'head-probe-continuation-drop-load-reply', 'head-probe-inflight-drop-load-reply', 'merge-probe-continuation-drop-load-reply', 'merge-probe-inflight-drop-load-reply'].map(row).join('\n');
  const wm = [];
  for (const arm of ['head', 'merge']) for (const k of ['continuation-drop-load-reply', 'inflight-drop-load-reply', 'continuation-db-cancel-drop-load-reply', 'inflight-db-cancel-drop-load-reply', 'acqfail-continuation-drop-load-reply', 'acqfail-inflight-drop-load-reply', 'probe-continuation-drop-load-reply', 'probe-inflight-drop-load-reply', 'late-continuation-drop-load-reply']) {
    const r = R(`${arm}-${k}`); const ls = r.loadReplies.filter((l) => l.status === 200); const d = ls.find((l) => l.dropped);
    for (const l of ls.filter((l) => !l.dropped)) { const A = JSON.parse(d.body), B = JSON.parse(l.body); const w = [A.lastEventId, B.lastEventId]; delete A.lastEventId; delete B.lastEventId; wm.push({ same: JSON.stringify(A) === JSON.stringify(B), moved: w[1] > w[0], w }); }
  }
  const late = (label) => { const L = R(label).lateLoad; const d = L.duringContinuation, a = L.afterTerminal; return `${label.replace(/-late-continuation-drop-load-reply/, '').padEnd(6)} mid-continuation  <span class="${d.status === 409 ? 'g' : 'r'}">${d.status}${d.status === 409 ? ' ' + code(d.body).replace(/^hosted_session_/, '') : d.hasRecovery ? ' + recovery snapshot' : ''}</span> · Broker acquires ${L.acquiresDuring}\n       after terminal    ${a.status}${a.hasRecovery ? ' + recovery' : ' (attachment restated)'}`; };
  const body = `<div class="col" style="margin-bottom:14px"><h2>Three identical takeover loads fired concurrently at Harness B right after the cut reply, then a flag-less load and a create</h2><pre><span class="m">${'run'.padEnd(28)} ${'3 redrives'.padEnd(14)} Broker               non-regression</span>
${probeRows}</pre><div class="dim" style="margin-top:6px">= : body byte-identical to the cut reply. Each redrive re-acquired the Runtime Session (real Broker: 200, same runtimeSessionId and binding id/generation every time); no extra <code>:start</code> — the in-flight run's single start is the first load's own drive.</div></div>
<div class="cols"><div class="col"><h2>Watermark of the coordinator's own redrive</h2><pre>${wm.length} redrives after a cut reply (head + merge):
  everything except lastEventId identical  <span class="g">${wm.filter((x) => x.same).length}/${wm.length}</span>
  lastEventId moved forward                <span class="y">${wm.filter((x) => x.moved).length}/${wm.length}</span>  (e.g. ${esc(wm.slice(0, 4).map((x) => x.w.join('→')).join(', '))})

store commits between the cut reply and the redrive:
  op=renewActivation  activation.changed   <span class="m">(activation lease renewal)</span></pre><div class="dim" style="margin-top:6px">The recovery snapshot, clientId and eventEpoch are re-derived identically; lastEventId is the live committed sequence, so it is only byte-identical until the next activation renewal. The coordinator requires continue's admission lastEventId ≥ the attachment's, so a fresher watermark is safe.</div></div>
<div class="col"><h2>Late duplicate takeover load while the admitted continuation streams</h2><pre>${['head-late-continuation-drop-load-reply', 'merge-late-continuation-drop-load-reply', 'mut6-late-continuation-drop-load-reply'].map(late).join('\n')}</pre><div class="dim" style="margin-top:6px"><b>mut6</b> = head with <code>attached.active !== undefined ||</code> removed from the redrive guard. Without it, a duplicate that arrives mid-continuation is answered 200 with a recovery snapshot of a Turn whose continuation is already admitted, and touches the Broker. No unit test fails for this mutant (U6 in figure 5).</div></div></div>`;
  writeFileSync('/Users/wenshao/pr13350-rig/fig/04-redrive-probes.html', page('Redrive edges on the real stack: concurrency, non-regression, watermark, late duplicates', 'All probes hit Harness B directly with the coordinator\'s own captured headers and body, while the coordinator\'s next redrive was held back.', body));
}

// ---------- 05 runner + units ----------
{
  const tll = (f) => { const s = readFileSync(`${E2E}/${f}.out`, 'utf8'); const i = s.lastIndexOf('{\n  "knownGap'); if (i < 0) { const e = readFileSync(`${E2E}/${f}.err`, 'utf8'); return /Takeover recovered despite/.test(e) ? ['g', 'THROWS "Takeover recovered despite the lost load reply — fix has landed"'] : ['y', 'other failure']; } const o = JSON.parse(s.slice(i)); const seq = o.loadAttempts.filter((a) => !/dropped/.test(a)).map((a) => a.split('-> ')[1]); const out = [seq[0] + '✂']; for (const x of seq.slice(1)) out.push(x); const c = []; for (const t of out) { const l = c.at(-1); if (l && l.t === t) l.n++; else c.push({ t, n: 1 }); } return [o.refusedWithConflict > 0 ? 'r' : 'y', `"reproduced": true   loads ${c.map((x) => x.n > 1 ? `${x.t}×${x.n}` : x.t).join(' → ')}   turn ${o.turnStatus}${o.waitedMs ? ` after ${Math.round(o.waitedMs / 1000)} s` : ''}`]; };
  const line = (lbl, f) => { const [c, t] = tll(f); return `${lbl.padEnd(30)} <span class="${c}">${esc(t)}</span>`; };
  const runner = [
    '<span class="m">as shipped in the issue (proxy buffers every non-load reply, 45 s wait)</span>',
    line('base  run 1', 'base-tll-1'), line('base  run 2', 'base-tll-2'),
    line('head  run 1', 'head-tll-1'), line('head  run 2', 'head-tll-2'),
    line('merge run 1', 'merge-tll-1'), line('merge run 2', 'merge-tll-2'),
    line('head  buffered, 120 s wait', 'head-tlld-buffered-1'),
    '', '<span class="m">same runner, proxy pipes non-load replies (SSE reaches the coordinator)</span>',
    line('head  run 1', 'head-tlld-stream-1'), line('head  run 2', 'head-tlld-stream-2'),
    line('merge run 1', 'merge-tlld-stream-1'), line('merge run 2', 'merge-tlld-stream-2'),
    line('base  run 1', 'base-tlld-stream-1'), line('base  run 2', 'base-tlld-stream-2'),
  ].join('\n');
  const um = readFileSync('/Users/wenshao/pr13350-rig/out/umut-pi.log', 'utf8').split('\n').filter((l) => /^U\d/.test(l)).map((l) => { const m = /^(U\d) exit=(\d) \d+s (.*?) :: Tests\s+(.*)$/.exec(l); return `${m[1]}  ${m[2] === '1' ? '<span class="g">killed  </span>' : '<span class="r">survived</span>'}  ${esc(m[3])}`; }).join('\n');
  const body = `<div class="col" style="margin-bottom:14px"><h2>Issue #13318's own runner mode <code>--takeover-load-loss</code> (uncommitted runner from the reporter's worktree)</h2><pre>${runner}</pre><div class="dim" style="margin-top:6px">On the fixed build the runner still prints <code>"reproduced": true</code>: the redrive is answered 200 and <code>continue</code> is admitted, but the load-drop proxy buffers the coordinator's SSE stream until it ends, so no event ever reaches Spring. Piping non-load replies is enough for the mode to fail loudly on head/merge and keep reproducing on base.</div></div>
<div class="cols"><div class="col"><h2>PR's runner, existing takeover modes</h2><pre>--continuation-failover   head <span class="g">3/3</span>   merge <span class="g">3/3</span>
--inflight-failover       head <span class="g">3/3</span>   merge <span class="g">3/3</span></pre><h2 style="margin-top:12px">Unit tests (Orange Pi, linux-arm64, idle)</h2><pre>hosted-harness-session.test.ts +
hosted-runtime-recovery.test.ts     <span class="g">209/209 × 3 runs</span></pre></div>
<div class="col"><h2>Unit mutation matrix on head (same two files)</h2><pre>${um}</pre></div></div>`;
  writeFileSync('/Users/wenshao/pr13350-rig/fig/05-runner-and-units.html', page('Reproduction runner, existing takeover gates, unit tests and mutants', 'Runner runs in the same Linux container as the matrix; unit runs on a second, idle host because the Mac was at load 100–200.', body));
}
console.log('figs 4-5 ok');
