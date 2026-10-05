// Builds 03-tests-mutants.html from mut/results.tsv and the verify logs.
import fs from 'node:fs';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad';
const desc = {
  MONITOR: 'whole file = main (synchronized + Object.wait/notifyAll)',
  SIGNAL_ONE: 'signalAll() → signal()',
  NO_SIGNAL: 'publish never signals',
  CLOSE_NOT_IDEMPOTENT: 'drop the closed guard in Subscription.close()',
  NO_DECREMENT: 'release() never decrements (buffer leak)',
  ALWAYS_EVICT: 'release() always reports last reference',
  UNINTERRUPTIBLE: 'await swallows InterruptedException',
  NO_TIMEOUT: 'awaitNanos(t) → await() (ignore timeout)',
  ALWAYS_WAIT: 'wait even when events are already buffered',
  NO_FLOOR: 'drop Math.max(1, …) floor',
  SIGNAL_FIRST: 'signalAll() before buffer mutation (same lock)',
};
const newTests = new Set(['SessionEventHubPinningTest', 'SessionEventHubTest#bufferIsEvictedWhenTheLastSubscriberCloses', 'SessionEventHubTest#closingOneOfTwoSubscribersKeepsTheBuffer', 'SessionEventHubTest#closingTheSameSubscriberTwiceKeepsTheBufferForTheOther', 'SessionEventHubTest#publishWakesEveryParkedSubscriber', 'SessionEventHubTest#awaitPropagatesInterruptionLikeObjectWait']);
const isNew = (t) => newTests.has(t) || newTests.has(t.split('#')[0]);
const rows = fs.readFileSync(`${S}/mut/results.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
let body = '';
for (const [m, jdk, verdict, secs, , failed = ''] of rows) {
  if (m === 'NONE') continue;
  const tests = failed.trim().split(/\s+(?=[A-Z][A-Za-z0-9]*Test#)/).filter(Boolean);
  let killer;
  if (verdict === 'KILLED-TIMEOUT') killer = '<span class="old">suite hangs (surefire fork timeout 420 s)</span>';
  else if (verdict === 'SURVIVED') killer = m === 'MONITOR' ? '<span class="dim">expected: JDK 24+ monitors do not pin (JEP 491)</span>' : '<span class="dim">equivalent in practice — see note</span>';
  else {
    const n = tests.filter(isNew).map((t) => t.replace('SessionEventHubTest#', '').replace('SessionEventHubPinningTest#', 'Pinning#'));
    const o = tests.filter((t) => !isNew(t));
    killer = (n.length ? `<span class="new">new: ${n.join(', ')}</span>` : '') + (o.length ? `${n.length ? '<br>' : ''}<span class="old">pre-existing: ${o.length} test${o.length > 1 ? 's' : ''} (${[...new Set(o.map((t) => t.split('#')[0]))].join(', ')})</span>` : '');
  }
  const vcls = verdict.startsWith('KILLED') ? 'ok' : (m === 'MONITOR' ? 'dim' : 'warn');
  body += `<tr><td>${m}</td><td class="dim">${desc[m]}</td><td>${jdk.replace('jdk', 'JDK ')}</td><td class="${vcls}">${verdict.replace('KILLED-TIMEOUT', 'KILLED (hang)')}</td><td>${killer}</td></tr>`;
}
const verify = (arm) => {
  try { return fs.readFileSync(`${S}/logs/verify-${arm}.out`, 'utf8').trim(); } catch { return `${arm}: not run`; }
};
const fmt = (arm, sha) => {
  const v = verify(arm);
  const m = /exit=(\d+) wall=(\d+)s \| Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+) \| You have (\d+) Checkstyle violations BugInstance size is (\d+)/.exec(v);
  if (!m) throw new Error(`unparsed verify ${arm}: ${v}`);
  const ok = m[1] === '0' && m[4] === '0' && m[5] === '0';
  return `<span class="${ok ? 'ok' : 'bad'}">${(arm === 'mut' ? 'merge' : arm).padEnd(8)}</span> mvn verify @ ${sha}: ${m[3]} tests, ${m[4]} failures, ${m[5]} errors, ${m[6]} skipped (RuntimeBrokerDefaultOnTest) · checkstyle ${m[7]} · spotbugs ${m[8]} · ${m[2]} s`;
};
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#c9d1d9}
#card{display:inline-block;padding:26px 30px 22px;background:#0d1117;width:1500px}
h1{font-size:22px;margin:0 0 4px;color:#f0f6fc}
h2{font-size:15px;margin:16px 0 6px;color:#58a6ff}
.sub{font-size:13.5px;color:#8b949e;margin-bottom:6px}
pre{margin:0;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 14px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
table{border-collapse:collapse;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;width:100%}
th{color:#8b949e;font-weight:600;text-align:left;padding:5px 10px;border-bottom:1px solid #30363d}
td{padding:5px 10px;border-bottom:1px solid #21262d;vertical-align:top}
td:nth-child(1),td:nth-child(3),td:nth-child(4){white-space:nowrap}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}.new{color:#3fb950}.old{color:#d2a8ff}
.note{margin-top:12px;border-left:3px solid #3fb950;padding:4px 12px;font-size:13.5px;line-height:1.45}
</style><div id="card">
<h1>Unit witnesses, test plan and mutation matrix — SessionEventHub</h1>
<div class="sub">JDK 21.0.12 / 25.0.4 · trial merge 6bf9785da7 (worktree reset between mutants) · 6 hub/stream classes per mutant: SessionEventHubTest, SessionEventHubPinningTest, ManagedEventStreamServiceTest, ManagedEventReplayTest, Issue13181QueryBudgetTest, ManagedAgentServerIntegrationTest (95 tests)</div>
<h2>PR test plan, reproduced</h2>
<pre><span class="ok">fixed   </span> SessionEventHubPinningTest  1/1 green in 4.59 s · SessionEventHubTest 7/7 green
<span class="bad">monitor </span> (origin/main blob 4b05180b9b) SessionEventHubPinningTest <span class="bad">red after 62.06 s</span>:
         virtual-thread probe starved within 30 s of 300 subscribers parked in SessionEventHub.await on 9 carriers (progress=2)
<span class="warn">recipe  </span> \`git show HEAD^:…SessionEventHub.java\` at head 2552154bf3 → blob d3876c95c6 = the <span class="warn">fixed</span> file (HEAD^ is merge 8ac3c5fd83),
         so following the description verbatim leaves the witness green; use origin/main (or 17c182eda0) — open thread R2-1
${fmt('head', '2552154bf3')}
${fmt('mut', '6bf9785da7')}</pre>
<h2>Mutants (one per run, applied to the trial-merge SessionEventHub.java)</h2>
<table><tr><th>mutant</th><th>change</th><th>JDK</th><th>verdict</th><th>failing tests</th></tr>${body}</table>
<div class="note">Each behavior the PR claims to keep has its own killer. The pinning witness kills the restored monitor shape on JDK 21 only (on JDK 25 the same shape passes, as the PR states), and the 5 contract tests in SessionEventHubTest kill the refcount, wake-all and interrupt mutants that no pre-existing test catches. Two mutants survive, both equivalent in practice. NO_FLOOR: every caller passes ≥ 1 ns (ManagedEventStreamService.waitDuration clamps to 1 ns and the poll interval is positive). SIGNAL_FIRST: waiters cannot run until the lock is released, so signalling before or after the mutation is the same.</div>
</div>`;
fs.writeFileSync(`${S}/figs/03-tests-mutants.html`, html);
console.log('ok');
