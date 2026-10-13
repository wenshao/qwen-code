import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire('/Users/wenshao/git/qwen-code-x3/package.json');
const { chromium } = require('playwright');
const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'shots');
mkdirSync(out, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Line prefixes pick a colour: "++ " green, "-- " red, "!! " amber, "## " blue, "== " grey.
const pre = (text) =>
  '<pre>' +
  text
    .split('\n')
    .map((line) => {
      const tag = line.slice(0, 3);
      const body = esc(line.slice(3));
      if (tag === '++ ') return `<span class="ok">${body}</span>`;
      if (tag === '-- ') return `<span class="bad">${body}</span>`;
      if (tag === '!! ') return `<span class="warn">${body}</span>`;
      if (tag === '## ') return `<span class="hd">${body}</span>`;
      if (tag === '== ') return `<span class="dim">${body}</span>`;
      return esc(line);
    })
    .join('\n') +
  '</pre>';

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#8b949e;font-size:14px;margin-bottom:18px}
h2{font-size:15px;color:#79c0ff;margin:18px 0 6px}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px;line-height:1.5;background:#161b22;
  border:1px solid #30363d;border-radius:6px;padding:12px 14px;margin:0;white-space:pre;overflow:hidden}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.hd{color:#79c0ff}.dim{color:#8b949e}
.note{border-left:4px solid #d29922;padding:8px 14px;margin-top:16px;background:#1c2128;font-size:14.5px;line-height:1.5}
.note.good{border-color:#3fb950}
table{border-collapse:collapse;font-size:14px;margin-top:4px}
th,td{border:1px solid #30363d;padding:8px 12px;text-align:left;vertical-align:top}
th{background:#161b22;color:#79c0ff}
td.bad{color:#f85149;font-weight:600}td.ok{color:#3fb950;font-weight:600}.dimtxt{color:#8b949e;font-weight:400;font-size:12.5px}
code{font-family:ui-monospace,Menlo,monospace;background:#161b22;padding:1px 5px;border-radius:4px}
`;

const page = (title, sub, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(
    title,
  )}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;

const cards = [];

cards.push({
  name: '01-ci-failure-vs-hypothesis',
  html: page(
    'PR #14079 — what actually failed on main',
    'Run 38386181793 · job 115258432803 "Runtime Broker and Managed Agent MariaDB / Java 21" · commit fd95f04ff14d (verbatim log, timestamps trimmed)',
    '<h2>CI log</h2>' +
      pre(`11:23:46.2604 [INFO] Running com.alibaba.qwen.code.managedagent.HostedOperatorRecoveryProbeTest
-- 11:23:46.3492 [ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.085 s <<< FAILURE!
java.lang.AssertionError:
Expecting actual throwable to be an instance of:
  java.lang.AssertionError
but was:
--   java.io.IOException: No such process
	at java.base/sun.nio.ch.UnixFileDispatcherImpl.read0(Native Method)
	at java.base/sun.nio.ch.UnixFileDispatcherImpl.read(UnixFileDispatcherImpl.java:51)
	at java.base/sun.nio.ch.IOUtil.readIntoNativeBuffer(IOUtil.java:340)
	...(95 remaining lines not displayed ...)
	at ...HostedOperatorRecoveryProbeTest.cleansOwnedProcessesWhenAnEscapedPidFailsOwnershipValidation(HostedOperatorRecoveryProbeTest.java:48)`) +
      '<h2>The helper on the failing path (unchanged by this PR) vs. its siblings already on main</h2>' +
      pre(`## HostedOperatorRecoveryProbe.running()                         <- stopOwnedProcesses() <- close() finally{}
        try {
            String value = Files.readString(stat);                    // open() ... read() of /proc/<pid>/stat
            return value.charAt(value.lastIndexOf(')') + 2) != 'Z';
--         } catch (NoSuchFileException exited) {                     // ESRCH is a plain IOException: not caught
            return false;
        }

## HostedProcessCrashIT.running() / HostedShellOutputProbe.running()   (#12896, #12954)
++         } catch (java.io.IOException gone) {
++             return process.isAlive();
        }`) +
      `<div class="note">The test failed after <b>0.085 s</b>, at line 48 (<code>assertThatThrownBy(probe::close)</code>). It did not fail on a 5 s <code>waitFor</code> or on the 10 s poll deadline, which are the four values this PR raises to 60 s. The thrown exception is <code>IOException: No such process</code> (ESRCH), which the <code>finally { stopOwnedProcesses(); }</code> in <code>close()</code> throws over the expected cwd-mismatch <code>AssertionError</code>.</div>`,
  ),
});

cards.push({
  name: '02-mechanism-on-real-linux',
  html: page(
    'Mechanism replayed on real Linux',
    'Debian 13 · kernel 6.12.105 arm64 · Temurin 21.0.9 · Docker container, 4-CPU quota',
    '<h2>Deterministic: open /proc/&lt;pid&gt;/stat, SIGKILL + reap the child, then read (EsrchDemo.java, 25 lines)</h2>' +
      pre(`$ java EsrchDemo.java
child pid=122 stat exists=true
after SIGKILL+reap: isAlive=false stat exists=false
-- read threw java.io.IOException: No such process
-- instanceof NoSuchFileException = false
    at java.base/sun.nio.ch.UnixFileDispatcherImpl.read0(Native Method)
    at java.base/sun.nio.ch.UnixFileDispatcherImpl.read(UnixFileDispatcherImpl.java:51)
    at java.base/sun.nio.ch.IOUtil.readIntoNativeBuffer(IOUtil.java:340)        <- same three frames as CI`) +
      '<h2>Natural failure of the real test body on PR head cd341270e0 (full in-repo frames, AssertJ truncation lifted)</h2>' +
      pre(`SAMPLE esrch iteration=4 elapsedMs=114 -> Expecting ... AssertionError but was: java.io.IOException: No such process
    at java.base/sun.nio.ch.UnixFileDispatcherImpl.read0(Native Method)
    at java.base/java.nio.file.Files.readString(Files.java:3359)
    at java.base/java.nio.file.Files.readString(Files.java:3318)
--     at ...HostedOperatorRecoveryProbe.running(HostedOperatorRecoveryProbe.java:233)
    at ...HostedOperatorRecoveryProbe.stopOwnedProcesses(HostedOperatorRecoveryProbe.java:244)
!!     at ...HostedOperatorRecoveryProbe.close(HostedOperatorRecoveryProbe.java:267)        <- finally{} replaces the cwd AssertionError
    at ...HostedOperatorRecoveryProbeTest.cleansOwnedProcessesWhen...(HostedOperatorRecoveryProbeTest.java:48)`) +
      `<div class="note">Race: <code>stopOwnedProcesses()</code> SIGKILLs the fixture children and polls <code>running()</code>. The JVM's process-reaper thread <code>waitpid()</code>s each child at the same moment. If the reap lands between <code>open()</code> and <code>read()</code> of <code>/proc/&lt;pid&gt;/stat</code>, the kernel returns ESRCH. Java reports that as a plain <code>IOException</code>, not a <code>NoSuchFileException</code>.</div>`,
  ),
});

const table = `<table>
<tr><th>Scenario (same container; arms in a row run concurrently)</th><th>base 58c59136ca</th><th>PR head cd341270e0<br>= merge 29663f8772<br>(60 s ceilings)</th><th>candidate A<br>catch IOException →<br>return isAlive()</th><th>candidate B<br>catch IOException →<br>rethrow if alive</th></tr>
<tr><td>Real test body in a loop, idle host, 120 s</td><td class="bad">10 / 4514 failed</td><td class="bad">6 / 4511 failed</td><td class="ok">0 / 4516 failed</td><td class="ok">0 / 4562 failed<br><span class="dimtxt">(paired run: head 4 / 4562)</span></td></tr>
<tr><td>Same, CPU-contended (8 busy loops in a 4-CPU quota), 120 s</td><td class="bad">12 / 1576 failed</td><td class="bad">14 / 1577 failed</td><td class="ok">0 / 1584 failed</td><td>not run</td></tr>
<tr><td>JDI holds main thread 300 ms between open() and read() in running(), 200 iterations</td><td class="bad">198 forced → 198 failed</td><td class="bad">200 forced → 200 failed</td><td class="ok">198 forced → 0 failed</td><td class="ok">200 forced → 0 failed</td></tr>
<tr><td>Stock <code>surefire:test -Dtest=HostedOperatorRecoveryProbeTest</code> + same JDI hold</td><td class="bad">FAIL: line 48, No such process</td><td class="bad">FAIL: identical to CI</td><td class="ok">PASS</td><td class="ok">PASS</td></tr>
<tr><td>Stock run, no injection</td><td class="ok">PASS (1.16 s)</td><td class="ok">PASS (1.16 s)</td><td class="ok">PASS (1.08 s)</td><td class="ok">PASS (1.15 s)</td></tr>
<tr><td>Failures caused by a timeout / deadline (any phase)</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>
</table>`;

cards.push({
  name: '03-ab-results',
  html: page(
    'A/B on real Linux: base vs PR head (as merged) vs two candidate fixes',
    'Every failure in every arm is the CI signature "Expecting AssertionError but was IOException: No such process"; none is a waitFor / deadline timeout',
    table +
      `<div class="note">Widening the four ceilings changes nothing measurable: PR head fails at the same rate as base, by the same exception, in milliseconds. Either one-catch candidate in <code>running()</code> removes every failure in every scenario: A is the idiom the sibling helpers already use; B also keeps reporting a read failure on a process that is still alive.</div>`,
  ),
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
const pg = await ctx.newPage();
for (const card of cards) {
  const file = path.join(out, card.name + '.html');
  writeFileSync(file, card.html);
  await pg.goto('file://' + file);
  const clipped = await pg.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length,
  );
  await pg.locator('#card').screenshot({ path: path.join(out, card.name + '.png') });
  console.log(card.name, 'clippedPre=' + clipped);
}
await browser.close();
