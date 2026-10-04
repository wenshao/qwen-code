// Evidence cards for PR #13365, built from the run artifacts in the
// scratchpad and screenshotted with the PR tree's Playwright. English only;
// the Chinese text lives in the PR comment's collapsed block.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/82bd70be-da86-4042-ac1d-b63b9f729043/scratchpad';
const OUT = `${S}/figs/out`;
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const read = (p) => fs.readFileSync(p, 'utf8');
const jsonl = (p) => read(p).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--amber:#d29922}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{width:1360px;padding:28px 32px 24px;background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--mut);margin:0 0 6px;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:6px 10px;vertical-align:top;text-align:left}
th{background:var(--panel);color:var(--mut);font-weight:600}td.c,th.c{text-align:center}
code,.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
pre{background:var(--panel);border:1px solid var(--line);padding:10px 12px;margin:0;white-space:pre;overflow:hidden;line-height:1.4}
.ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.mut{color:var(--mut)}.blue{color:var(--blue)}
.note{border-left:3px solid var(--amber);padding:8px 12px;margin-top:14px;background:var(--panel);font-size:14px}
.note.ok{border-color:var(--green)}.note.bad{border-color:var(--red)}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.p-red{background:#3d1214;color:#ffa198}.p-green{background:#0f2e1a;color:#7ee787}.p-amber{background:#3a2a07;color:#e3b341}.p-blue{background:#0c2d4f;color:#79c0ff}
.foot{color:var(--mut);font-size:12px;margin-top:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
`;
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}${foot ? `<div class="foot">${foot}</div>` : ''}</div></body></html>`;
const cell = (fail, total) => fail === 0 ? `<td class="c ok">0 / ${total}</td>` : `<td class="c bad">${fail} / ${total}</td>`;

// ---------- IT logs ----------
function itRounds(file) {
  return read(file).split('\n').filter((l) => l.includes('ISSUE13333 round')).map((l) => {
    const m = l.match(/staggerMs=(\d+) burst=(\d+) turns=(\d+).*admissionFailures=(\d+)/);
    return { stagger: +m[1], burst: +m[2], fail: +m[4] };
  });
}
const IT_ARMS = [
  ['base', 'merge-base store (8a1a2efe27) + new IT', ['base-r1', 'base-r2']],
  ['mturn', 'PR minus the turn-probe hunk', ['mturn-r1', 'mturn-r2']],
  ['mscope', 'PR minus the scope hunk', ['mscope-r1', 'mscope-r2']],
  ['pr', 'PR head 9df557594f', ['pr-r1', 'pr-r2']],
];

// ---------- real stack ----------
const A = JSON.parse(read(`${S}/rig/summary-a.json`));
const aCell = (arm, scenario, n) => {
  const r = A.find((x) => x.arm === arm && x.scenario === scenario && x.n === n);
  return r ? cell(r.e500, r.requests) : '<td class="c mut">-</td>';
};
// 12/16-way admissions: base from the first matrix (3 reps, no wedge since 1 Turn/burst), PR from fresh-JVM probes.
const admissions = (runs, n) => {
  let fail = 0, total = 0;
  for (const run of runs) {
    const f = `${S}/runs/${run}/rounds.jsonl`;
    if (!fs.existsSync(f)) continue;
    for (const r of jsonl(f)) if (r.scenario === 'diffkey' && r.n === n) for (const [k, v] of Object.entries(r.submit ?? {})) { total += v; if (k !== '202') fail += v; }
  }
  return { fail, total };
};

// ---------- probe ----------
const probe = {};
for (const l of read(`${S}/probe/matrix.txt`).split('\n').filter((x) => x.startsWith('RESULT'))) {
  const m = l.match(/mode=(\S+) variant=(\S+) n=(\d+) reps=(\d+) repsWithDeadlock=(\d+) outcomes=\{(.*)\}/);
  const outcomes = Object.fromEntries(m[6].split(', ').map((kv) => kv.split('=')).map(([k, v]) => [k, +v]));
  probe[`${m[1]}|${m[2]}|${m[3]}`] = { reps: +m[4], repsDl: +m[5], deadlocks: outcomes.deadlock ?? 0, n: +m[3] };
}
const pCell = (mode, variant, n) => {
  const p = probe[`${mode}|${variant}|${n}`];
  if (!p) return '<td class="c mut">-</td>';
  return p.deadlocks === 0 ? `<td class="c ok">0 deadlocks</td>` : `<td class="c bad">${p.deadlocks / p.reps} of ${n} per rep<br><span class="mut">${p.repsDl}/${p.reps} reps</span></td>`;
};

// ---------- Figure 1 ----------
function fig1() {
  const itRows = IT_ARMS.map(([arm, label, files]) => {
    const rounds = files.flatMap((f) => itRounds(`${S}/it/${f}.log`));
    const tds = [4, 8, 12].map((b) => {
      const rs = rounds.filter((r) => r.stagger === 0 && r.burst === b);
      return cell(rs.reduce((s, r) => s + r.fail, 0), rs.length * b);
    }).join('');
    const stag = rounds.filter((r) => r.stagger === 500);
    const stagFail = stag.reduce((s, r) => s + r.fail, 0);
    return `<tr><td><b>${arm}</b> <span class="mut">${label}</span></td>${tds}<td class="c ${stagFail ? 'bad' : 'ok'}">${stagFail} failures</td></tr>`;
  }).join('');
  const b12 = admissions(['m-base-p1'], 12), b16 = admissions(['m-base-p1'], 16);
  const p12 = admissions(['m-pr-p1', 'b-pr-n12'], 12), p16 = admissions(['m-pr-p1', 'b-pr-n16', 'b-pr-stag-n16', 'b-pr-par64-n16', 'b-pr-jdk25-n16'], 16);
  const realRows = [
    ['base', aCell('base', 'diffkey', 4), aCell('base', 'diffkey', 8), cell(b12.fail, b12.total), cell(b16.fail, b16.total)],
    ['pr', aCell('pr', 'diffkey', 4), aCell('pr', 'diffkey', 8), cell(p12.fail, p12.total), cell(p16.fail, p16.total)],
    ['mscope', aCell('mscope', 'diffkey', 4), aCell('mscope', 'diffkey', 8), '<td class="c mut">-</td>', '<td class="c mut">-</td>'],
  ].map(([a, ...c]) => `<tr><td><b>${a}</b></td>${c.join('')}</tr>`).join('');
  const probeRows = ['old', 'new'].map((v) => `<tr><td><b>${v === 'old' ? 'base' : 'pr'}</b> <span class="mut">${v === 'old' ? 'probe SELECT … FOR UPDATE, then INSERT' : 'plain probe, then INSERT'}</span></td>${[4, 8, 12].map((n) => pCell('turn-diff', v, n)).join('')}</tr>`).join('');
  const body = `
<h2>1 · New IT on MySQL 8.4.7 — failed submissions in the stagger-0 rounds (2 runs per arm)</h2>
<table><tr><th>arm</th><th class="c">burst 4</th><th class="c">burst 8</th><th class="c">burst 12</th><th class="c">500 ms-staggered rounds</th></tr>${itRows}</table>
<h2>2 · Packaged stack (Spring jar + qwen serve --profile hosted-harness + MySQL 8.4.7) — distinct-key Turn submits returning 500</h2>
<table><tr><th>arm</th><th class="c">4-way</th><th class="c">8-way</th><th class="c">12-way</th><th class="c">16-way</th></tr>${realRows}</table>
<h2>3 · Lock probe: the exact admission SQL, barrier-aligned (20 reps per cell)</h2>
<table><tr><th>variant</th><th class="c">4 Turns</th><th class="c">8 Turns</th><th class="c">12 Turns</th></tr>${probeRows}</table>
<div class="note ok">The turn-probe hunk is the fix: removing it alone (<b>mturn</b>) brings back the N−1-of-N failures, while removing the scope hunk (<b>mscope</b>) changes nothing. Every base failure is <code>submit:500 internal_error</code>, and InnoDB's deadlock counter rises by exactly N−1 per burst.</div>`;
  return page('#13365 · The turn-probe change removes the admission deadlock', 'Same-tenant bursts with distinct idempotency keys · head 9df557594f · base = merge-base 8a1a2efe27 · MySQL 8.4.7 native · JDK 21', body,
    'IT: HostedConcurrentTurnBurstMySqlIT via -Phosted-harness-mysql. Packaged stack: 3–6 rounds per 4/8-way cell; 12/16-way: base from 3 reps of one run; PR from the first matrix run plus 1 (12-way) or 4 (16-way) fresh-JVM probes. Admission only: whether those Turns then finish is figure 3. A cell reads "failed / submitted".');
}

// ---------- Figure 2 ----------
function fig2() {
  const sameRows = [['samekey-create', 'public create', [2, 3, 4, 8]], ['samekey-create-ws', 'Workspace create', [3, 8]]].flatMap(([sc, label, ns]) =>
    ns.map((n) => `<tr><td>${label}, ${n} requests, one key</td>${['base', 'pr', 'mscope'].map((a) => aCell(a, sc, n)).join('')}</tr>`)).join('');
  const diffRows = `<tr><td>Workspace create, 8 distinct keys</td>${['base', 'pr', 'mscope'].map((a) => aCell(a, 'diffkey-ws', 8)).join('')}</tr><tr><td>same-key Turn submit, 8 requests</td>${['base', 'pr', 'mscope'].map((a) => aCell(a, 'samekey-submit', 8)).join('')}</tr>`;
  const probeSame = ['old', 'new', 'share'].map((v) => `<tr><td><b>${{ old: 'base', new: 'pr', share: 'FOR SHARE re-read' }[v]}</b> <span class="mut">${{ old: 'ODKU + FOR UPDATE', new: 'INSERT; on dup FOR UPDATE', share: 'INSERT; on dup FOR SHARE (not H2-compatible)' }[v]}</span></td>${[2, 3, 4, 8].map((n) => pCell('scope-same', v, n)).join('')}</tr>`).join('');
  const probeDiff = ['old', 'new'].map((v) => `<tr><td><b>${v === 'old' ? 'base' : 'pr'}</b></td>${[4, 8, 12].map((n) => pCell('scope-diff', v, n)).join('')}</tr>`).join('');
  const dl = read(`${S}/probe/innodb-scope-same-new.txt`);
  const pick = (re) => (dl.match(re) ?? [''])[0];
  const excerpt = [
    '*** (1) TRANSACTION:  SELECT workspace_bound FROM managed_session_create_scope WHERE … FOR UPDATE',
    '*** (1) HOLDS THE LOCK(S):        index PRIMARY … ' + pick(/lock mode S locks rec but not gap/),
    '*** (1) WAITING FOR THIS LOCK:    index PRIMARY … ' + pick(/lock_mode X locks rec but not gap waiting/),
    '*** (2) TRANSACTION:  SELECT workspace_bound FROM managed_session_create_scope WHERE … FOR UPDATE',
    '*** (2) HOLDS THE LOCK(S):        index PRIMARY … lock mode S locks rec but not gap',
    '*** (2) WAITING FOR THIS LOCK:    index PRIMARY … lock_mode X locks rec but not gap waiting',
    '*** WE ROLL BACK TRANSACTION (' + (dl.match(/WE ROLL BACK TRANSACTION \((\d)\)/)?.[1] ?? '?') + ')',
  ].join('\n');
  const body = `
<h2>1 · Packaged stack — concurrent requests that reuse one idempotency key (3 + 3 rounds per cell, 500s / requests)</h2>
<table><tr><th>scenario</th><th class="c">base</th><th class="c">pr</th><th class="c">mscope (PR minus scope hunk)</th></tr>${sameRows}${diffRows}</table>
<div class="grid"><div>
<h2>2 · Lock probe · scope step, one key (1 winner + N−1 losers)</h2>
<table><tr><th>variant</th><th class="c">N=2</th><th class="c">N=3</th><th class="c">N=4</th><th class="c">N=8</th></tr>${probeSame}</table>
</div><div>
<h2>3 · Lock probe · scope step, distinct keys, one tenant</h2>
<table><tr><th>variant</th><th class="c">4</th><th class="c">8</th><th class="c">12</th></tr>${probeDiff}</table>
<div class="note">The PR describes the old ODKU + <code>FOR UPDATE</code> sequence as exposed to next-key/gap-lock deadlocks under concurrent adjacent-key inserts. Neither the probe nor the IT nor the packaged stack reproduces that.</div>
</div></div>
<h2>4 · InnoDB, PR scope path, 1 winner + 2 losers on one key</h2>
<pre>${esc(excerpt)}</pre>
<div class="note bad">With the PR, a failed duplicate check leaves each loser holding <b>S</b> on the committed scope row, and the <code>FOR UPDATE</code> re-read then asks for <b>X</b>. With N ≥ 3 racers, N−2 of them become deadlock victims and get <code>500 internal_error</code>: 1/3, 2/4 and 6/8 in every round, on both the public and the Workspace create paths. Base (and mscope) queue those losers on ODKU's <b>X</b> lock instead, and every one of them gets a 202 replay of the same Session.</div>`;
  return page('#13365 · The scope hunk: nothing exercises it, and it adds a same-key deadlock', 'Same-key create races on head vs base vs PR-minus-scope-hunk · invariants (one Session per key, one Turn per key) held in every arm', body,
    'Same-key creates: N concurrent POST /v1/agents/sessions sharing one Idempotency-Key, fired with Promise.all. Lock probe: JDBC replay of requireCreationScope with the losers queued behind an uncommitted winner (innodb_trx LOCK WAIT = N−1), then the winner commits.');
}

// ---------- Figure 3 ----------
function fig3() {
  const runs = [
    ['b-pr-n8', 'pr', 'simultaneous', 'JDK 21', 8],
    ['b-pr-n10', 'pr', 'simultaneous', 'JDK 21', 10],
    ['b-pr-n12', 'pr', 'simultaneous', 'JDK 21', 12],
    ['b-pr-n16', 'pr', 'simultaneous', 'JDK 21', 16],
    ['b-base-stag-n8', 'base', '200 ms stagger', 'JDK 21', 8],
    ['b-base-stag-n12', 'base', '200 ms stagger', 'JDK 21', 12],
    ['b-base-stag-n16', 'base', '200 ms stagger', 'JDK 21', 16],
    ['b-pr-stag-n16', 'pr', '200 ms stagger', 'JDK 21', 16],
    ['c-pr-par8-n4', 'pr', 'simultaneous', 'JDK 21, parallelism=8 (8-core rig)', 4],
    ['c-pr-par8-n8', 'pr', 'simultaneous', 'JDK 21, parallelism=8 (8-core rig)', 8],
    ['b-pr-par64-n16', 'pr', 'simultaneous', 'JDK 21, parallelism=64', 16],
    ['b-pr-jdk25-n16', 'pr', 'simultaneous', 'JDK 25 (JEP 491)', 16],
  ];
  const rows = runs.map(([run, arm, pattern, jvm, n]) => {
    const r = jsonl(`${S}/runs/${run}/rounds.jsonl`)[0];
    const admitted = r.submit?.['202'] ?? 0;
    const status = typeof r.turnStatus === 'string' ? r.turnStatus.split('\n').map((l) => l.replace('\t', ' ')).join(', ') : Object.entries(r.turnStatus).map(([k, v]) => `${k} ${v}`).join(', ');
    const out = r.stalled ? `<span class="pill p-red">wedged</span> after 90 s: ${status}` : `<span class="pill p-green">settled</span> in ${(r.settleMs / 1000).toFixed(1)} s: ${status}`;
    const pin = r.stalled ? `<span class="bad">${r.pinnedVirtualThreads} pinned · ${r.carriersBusy} carriers busy</span>` : '<span class="mut">-</span>';
    return `<tr><td><b>${arm}</b></td><td>${pattern}</td><td>${jvm}</td><td class="c">${admitted}/${n}</td><td>${out}</td><td>${pin}</td></tr>`;
  }).join('');
  const dumpFile = fs.readdirSync(`${S}/runs/b-pr-n12`).find((f) => f.endsWith('-vthreads.txt'));
  const block = read(`${S}/runs/b-pr-n12/${dumpFile}`).split(/\n\s*\n/).find((b) => b.includes('parkOnCarrierThread'));
  const keep = /parkOnCarrierThread|ArrayBlockingQueue\.take|HttpResponseInputStream\.read|SseReader\.next|HarnessEventStream\.next|QwenHostedHarnessConnector\$1\.next|HarnessCoordinator\.readStream|VirtualThread\.run/;
  const lines = block.split('\n');
  const notes = { parkOnCarrierThread: '   <- parked on the carrier: pinned', 'HarnessEventStream.next': '   <- public synchronized DaemonEvent next()' };
  const frames = lines.slice(1).filter((l) => keep.test(l)).map((l) => {
    const t = l.trim().replace(/^java\.base\/|^java\.net\.http\//, '');
    const n = Object.entries(notes).find(([k]) => t.includes(k));
    return '  ' + t + (n ? n[1] : '');
  });
  const traceLog = read(`${S}/runs/b-pr-trace-n12/spring.log`);
  const traced = [...new Set(traceLog.split('\n').filter((l) => l.includes('<== monitors') && /HarnessEventStream|persistResourceHandle/.test(l)).map((l) => '  ' + l.trim()))];
  const stack = esc([lines[0] + '   (stall dump b-pr-n12; all 10 pinned threads share this stack, frames filtered)', ...frames, '', '-Djdk.tracePinnedThreads=full (b-pr-trace-n12), distinct pinning sites in our code:', ...traced].join('\n'));
  const body = `
<h2>Fresh JVM per row · fake model streams each reply over 5 s so the Turns overlap · 10-core host → 10 carriers unless parallelism is set</h2>
<table><tr><th>arm</th><th>submits</th><th>JVM</th><th class="c">admitted</th><th>Turns</th><th>thread dump</th></tr>${rows}</table>
<h2>Where the carriers go</h2>
<pre>${stack}</pre>
<div class="note bad">This bug predates the PR: <b>base</b> wedges in exactly the same way once its submissions are staggered past the admission deadlock. Every Turn's stream reader blocks on the SSE socket inside <code>synchronized HarnessEventStream.next()</code>, and on JDK 21 that pins its carrier. Once as many streams are open as there are cores, every carrier is pinned, 24–48 started virtual threads never mount, and the whole server stops settling Turns. In the first wedged run, Turns submitted afterwards to other tenants stayed ACCEPTED for the remaining 10 minutes. More carriers or JDK 25 make it go away.</div>
<div class="note">What the PR changes: base fails N−1 of N simultaneous submits quickly, which kept bursts below the carrier count. The PR admits all of them, so a burst of ≥ #cores Turns now reaches the wedge directly. #13333 reports this shape on an 8-core Orange Pi 5: 4 Turns complete, while 8 and 12 sit RUNNING with zero events after <code>turn.started</code> and all Sessions admitted. Pinned to 8 carriers, this stack does the same here (4 settle, 8 wedge).</div>`;
  return page('#13365 · Pre-existing wedge that the fix now reaches: ≥ #cores concurrent Turns pin every JDK 21 carrier', 'Packaged stack, distinct-key Turn bursts · stall detected after 90 s with no progress, then jcmd Thread.print + Thread.dump_to_file', body,
    'carriers = ForkJoinPool-1 workers that show "Carrying virtual thread"; pinned = virtual threads parked in VirtualThread.parkOnCarrierThread. Model: 20 deltas spread over 5 s. Spring: same jar per arm, only the JVM flag or JDK changes between rows.');
}

function fig4() {
  const runs = [
    ['b-pr-n16', 'pr (unpatched SDK)', 'default (10)', 16],
    ['c-cand-n16', 'SDK patch', 'default (10)', 16],
    ['c-cand-n16-dump', 'SDK patch (rerun)', 'default (10)', 16],
    ['c-cand-par8-n12', 'SDK patch', '8', 12],
    ['c-cand-par4-n16', 'SDK patch', '4', 16],
    ['c-cand-par64-n16', 'SDK patch', '64', 16],
  ];
  const rows = runs.map(([run, arm, par, n]) => {
    const r = jsonl(`${S}/runs/${run}/rounds.jsonl`)[0];
    const warm = (read(`${S}/runs/${run}/spring.log`).match(/Managed Runtime warm failed/g) ?? []).length;
    const status = typeof r.turnStatus === 'string' ? r.turnStatus.split('\n').map((l) => l.replace('\t', ' ')).join(', ') : Object.entries(r.turnStatus).map(([k, v]) => `${k} ${v}`).join(', ');
    const out = r.stalled ? `<span class="pill p-red">wedged</span> after 90 s: ${status}` : r.settleMs > 30000 ? `<span class="pill p-amber">settled late</span> in ${(r.settleMs / 1000).toFixed(1)} s: ${status}` : `<span class="pill p-green">settled</span> in ${(r.settleMs / 1000).toFixed(1)} s: ${status}`;
    return `<tr><td><b>${arm}</b></td><td class="c">${par}</td><td class="c">${n}</td><td>${out}</td><td class="c ${warm ? 'bad' : 'ok'}">${warm}</td></tr>`;
  }).join('');
  const block = read(`${S}/stall/cand-mid-vthreads.txt`).split(/\n\s*\n/).find((b) => b.includes('parkOnCarrierThread') && b.includes('persistResourceHandle'));
  const keep = /parkOnCarrierThread|ClientPreparedStatement\.executeUpdate\(|lockPlacementDomain|JdbcRuntimeBindingRepository\.compareAndSet\(|persistResourceHandle|provisionDurableBinding\(|VirtualThread\.run/;
  const lines = block.split('\n');
  const frames = lines.slice(1).filter((l) => keep.test(l)).map((l) => '  ' + l.trim().replace(/^java\.base\//, '') + (l.includes('persistResourceHandle') ? '  <- synchronized' : l.includes('parkOnCarrierThread') ? '   <- pinned' : ''));
  const pinnedCount = read(`${S}/stall/cand-mid-vthreads.txt`).split(/\n\s*\n/).filter((b) => b.includes('parkOnCarrierThread') && b.includes('persistResourceHandle')).length;
  const cause = 'Caused by: com.mysql.cj.jdbc.exceptions.MySQLTransactionRollbackException: Lock wait timeout exceeded; try restarting transaction\n  at com.alibaba.qwen.code.runtimebroker.JdbcRuntimeBindingRepository.lockPlacementDomain(JdbcRuntimeBindingRepository.java:680)';
  const pre = esc([lines[0] + `   (mid-stall dump, SDK patch, 16 Turns, ~20 s after submit: ${pinnedCount} of 10 carriers pinned like this)`, ...frames, '', 'Spring log, 15 of 16 Sessions: WARN HarnessCoordinator : Managed Runtime warm failed …', cause].join('\n'));
  const body = `
<h2>Candidate: <code>HarnessEventStream</code> guards next()/close()/getLastEventId() with a ReentrantLock instead of <code>synchronized</code> (SDK suite 172/172, checkstyle 0)</h2>
<table><tr><th>SDK</th><th class="c">carriers</th><th class="c">Turns</th><th>outcome</th><th class="c">"Managed Runtime warm failed"</th></tr>${rows}</table>
<h2>What is left: a second monitor held across JDBC in the Runtime Broker</h2>
<pre>${pre}</pre>
<div class="note">With the SDK patch, every burst settles (including 16 Turns on 4 carriers) instead of wedging the server. But the carriers then pile up in the broker's <code>synchronized BindingRenewal.persistResourceHandle</code>, waiting on the placement-domain row lock. The owner of that lock cannot get a carrier back to commit, so the waiters sit until InnoDB's 50 s <code>innodb_lock_wait_timeout</code> fails them. Result: 15 of 16 warm-ups fail and every Turn finishes at ~56.6 s instead of ~7 s. With 64 carriers the same jar settles in 7.3 s with no warm failures.</div>
<div class="note ok">A complete fix removes monitors around blocking I/O on virtual-thread paths in both <code>qwencode</code> (<code>HarnessEventStream</code>) and <code>runtime-broker</code> (<code>BindingRenewal</code>, the <code>synchronized (context)</code> blocks around JDBC), or runs the server on JDK 24+ (JEP 491). The same unpatched jar on JDK 25 settled 16 Turns in 8.1 s.</div>`;
  return page('#13365 follow-up · A candidate SDK patch removes the permanent wedge; a broker monitor still stalls for 50 s', 'Packaged stack, distinct-key 16-way and 12-way bursts, fake model 5 s/reply · candidate jar verified to embed the patched class', body,
    'Candidate patch and rig scripts are in the assets branch. This is outside #13365\'s diff; it is here because #13365 is what lets ≥ #cores Turns through admission at once.');
}

const figs = [['01-admission-fix', fig1()], ['02-scope-hunk', fig2()], ['03-carrier-pinning-wedge', fig3()], ['04-candidate-sdk-patch', fig4()]];
const require = createRequire(`${S}/wt-pr/package.json`);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1424, height: 900 } });
const pg = await ctx.newPage();
for (const [name, html] of figs) {
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await pg.goto(`file://${OUT}/${name}.html`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'clipped-pre:', clipped);
}
await browser.close();
