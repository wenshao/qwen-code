// Round-2 evidence cards for PR #13265 (head 9c1437ddd6). Numbers are copied
// from rig2/out, rig2/diff, rig2/mut and /Users/wenshao/pr13265-rig/out.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const LX = '/Users/wenshao/pr13265-rig/out';
const require = createRequire(`${SP}/wt-pr2/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = fs.readFileSync(`${SP}/figs/render.mjs`, 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 round 2 · head 9c1437ddd6 · macOS: Spring jar + MariaDB 10.11.18 + built core dist over the HTTP store · Linux: privileged container (kernel 6.8, cgroup v2, cgroupns private), node 22.23.2, the head\'s core/cli dist';
const result = (file) => JSON.parse(fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')).slice(9));
const cards = {};

// r2-01 — round-1 findings re-verified
{
  const s2 = result(`${SP}/rig2/out/s2-chain.log`);
  const d2 = result(`${SP}/rig2/out/s3-closure-D2.log`);
  const body = `
${table(['round 1', 'what the author changed (007289fee9)', 'real-stack check at 9c1437ddd6', 'status'], [
    ['F1 closure', 'child_run refs in verifyExtensionResources (TS) and applyRevision (Java)', { html: 'S3 A/B: ghost or foreign <span class="mono">commandRef</span> refused <b>before publish</b>, writer keeps working (was: 409 then writer stopped)<br>S3 G: ghost <span class="mono">startReceiptRef</span> / <span class="mono">outputRef</span> each refused at the revision that names it<br>S3 D2 (local checks off): Java answers <b>409 resource missing</b>, 0 rows (was: 200 ×4)' }, { t: 'fixed', cls: 'ok' }],
    ['F2 NPE', 'exitSignal.isTextual() guard + fixture exit-signal-numeric', { html: `S4: exitSignal 9 / true → <b>409</b> once, no retries, no NPE in the server log (was: 500 ×3)<br>differential: Java crashes <b>0</b> of 200,000 (was 1,706)` }, { t: 'fixed', cls: 'ok' }],
    ['F3 re-attach', 'startReceiptRef strictly set-once; fixtures reattach-same / reattach-changed', { html: 'S2 shell-3: new receipt under gen 2 refused, same receipt accepted → degraded/ready (TS = Java)<br>S4 Java-only: changed → 409, same → 200' }, { t: 'fixed', cls: 'ok' }],
    ['F4 body vs design', 'design trimmed; 11th key stopRequested → draining on both projections', { html: `S2 shell-4/5: <b>running/draining</b> while attached and while provisioning, in Java rows and the public API; clearing it refused; a start carrying it refused<br>projection differential: <b>8,410/8,410</b> identical, 66 of them draining` }, { t: 'fixed', cls: 'ok' }],
    ['F5 fixtures', 'stop-mismatch, quota-mismatch, … now single-rule; 4 new cases', { html: 'T21/T27 and J21/J27 now killed; 14 TS and 13 Java record conditions still unpinned (card 5)' }, { t: 'partly', cls: 'warn' }],
  ])}
<pre>S2 on the head stack: ${s2.commits} commits, ${s2.mismatches} mismatches between authority / Java row / public tasks API; cold reopen equal: ${s2.coldReopenEqual}
   output-only revisions emit no task.updated (projection unchanged) — ${s2.taskUpdated} events for ${s2.commits} commits
   outputRef pointing back at an older manifest is still accepted (bot thread R1-19): ${s2.outputRewind}
S3 D2 Java-only: ${esc(d2.D2.results[0])}
differential 200k: TS crashes 0 · Java crashes 0 · disagreements 272, all the known NFC case (#12837)</pre>
<div class="note ok">All four round-1 defects and decisions hold on the real stack. Java verify on the head: 553 unit + 52/52 MariaDB ITs, Checkstyle 0, <b>SpotBugs 0</b> (the bot's review could not run SpotBugs). Trial merges with main 5ddfacc9d4 and #13217 b81978cef2: clean; the #13217 merge passes 613 Java unit tests.</div>`;
  cards['r2-01-round1-fixes'] = page('Round-1 findings re-verified on the new head', 'macOS real stack (Spring + MariaDB + built TS dist) · S2/S3/S4 rerun · 200k differential + projection differential', body, FOOT);
}

// r2-02 — CI red
{
  const body = `
<h2>CI: Test (ubuntu-latest, Node 22.x) — run 37138662916, 2 failures, both reproduced locally</h2>
${table(['failing test', 'cause', 'local reproduction'], [
    [{ t: 'cli src/serve/process-env-guard.test.ts › allows only documented process-scoped process.env expressions', cls: 'mono' }, { html: 'new <span class="mono">backgroundEnv()</span> in managed-runtime-tool-executor.ts reads <span class="mono">process.env[key]</span> with a computed key that the guard\'s allow-list does not know' }, { html: 'head 9c1437ddd6: <span class="bad">fails</span> (same mismatch: file managed-runtime-tool-executor.ts, found computed:key 1)<br>base 691a374d2a: <span class="ok">3/3 pass</span>' }],
    [{ t: 'core src/hooks/hook-command-cgroup.test.ts › refuses to create or attach without a delegated Linux root', cls: 'mono' }, { html: '<span class="mono">attach()</span> calls <span class="mono">resolveRoot()</span> outside any try, so on Linux a missing root throws raw <span class="mono">ENOENT</span> from realpathSync; on macOS the platform check throws first, so the test passes there' }, { html: 'Linux container: <span class="mono">attach(\'/tmp/not-a-cgroup\')</span> → <span class="bad">Error ENOENT</span>; <span class="mono">create()</span> on the same root → HookCommandIsolationUnavailableError<br>with the candidate patch → HookCommandIsolationUnavailableError' }],
  ])}
<div class="note bad">Both are caused by this PR and block merge. The PR body lists macOS as the tested platform; the second failure exists only on Linux, the one platform where the cgroup code actually runs.</div>`;
  cards['r2-02-ci-red'] = page('CI is red on the head for two PR-caused reasons', 'Job log 111248462682 · both failures reproduced (macOS for the env guard, the Linux container for attach)', body, FOOT);
}

// r2-03 — supervisor on real Linux cgroup v2
{
  const h = result(`${LX}/l1-head.log`);
  const c = result(`${LX}/l1-cand2.log`);
  const ev = (e) => (e ? `exit=${e.exitCode} signal=${e.exitSignal}` : 'null (unproven)');
  const body = `
${table(['case on real cgroup v2', 'head 9c1437ddd6', 'with candidate patch (4 edits in hook-command-cgroup.ts)'], [
    ['L1 start: echo + setsid daemon + TERM-ignoring child + sleeper', { t: `${h.L1.members} members in the unit (setsid member included), stdout/stderr captured`, cls: 'ok' }, { t: 'same', cls: 'mut' }],
    ['L2b terminate, every member obeys TERM', { t: `${ev(h.L2b.evidence)}, unit removed: ${h.L2b.unitRemoved}`, cls: 'ok' }, { t: 'same', cls: 'mut' }],
    ['L2 terminate(1500), one member ignores TERM', { html: `<span class="bad">${ev(h.L2.evidence)}</span>, unit dir left: ${!h.L2.unitRemoved} (L2c: the unit reads empty 0 ms after the call; a second call returns SIGTERM)` }, { t: `${ev(c.L2.evidence)}, unit removed`, cls: 'ok' }],
    ['L7 registry.terminate, TERM-ignoring child', { html: `hold released, evidence ${ev(h.L7.evidence)}, <span class="bad">unit dir left: ${h.L7.unitDirLeft}</span>` }, { t: `unit dir left: ${c.L7.unitDirLeft}`, cls: 'ok' }],
    ['L4 command dies by a signal (kill -KILL $$, kill -SEGV $$)', { html: `<span class="bad">${ev(h.L4_selfkill)}</span> · <span class="bad">${ev(h.L4_segv)}</span> (launcher exits with code ?? 1)` }, { t: `${ev(c.L4_selfkill)} · ${ev(c.L4_segv)}`, cls: 'ok' }],
    ['L5 re-attach a live unit by name (fresh supervisor)', { html: `<span class="bad">attach() → undefined</span> for an existing, populated unit` }, { t: 'attach() → the unit', cls: 'ok' }],
    ['L3 natural exit while a setsid daemon (stdio detached) lives on', { html: `<span class="bad">hold released, success published</span>; unit populated, daemon alive, unit dir left` }, { t: 'unchanged (registry design)', cls: 'warn' }],
    ['L8 plain natural exit', { html: `<span class="warn">unit dir left: ${h.L8.unitDirLeft}</span>; supervisor map never forgotten (size ${h.L8.supervisorSize} after this run)` }, { t: 'unchanged (registry design)', cls: 'warn' }],
    ['L6 second start with a unit name in use', { html: `<span class="warn">"requires a delegated Linux cgroup v2 directory"</span> (misleading; first still running)` }, { t: 'unchanged', cls: 'warn' }],
  ])}
<pre>hook-command-cgroup.ts:104   if (unitName.includes('/') || unitName.includes('')) return undefined;   // '' is in every string → always undefined
hook-command-cgroup.ts:178   if (!(await this.waitForEmpty(graceMs))) this.kill();                  // no wait after cgroup.kill
managed-child-run-supervisor.ts:78  if (!this.unit.empty()) return null;                           // checked immediately → null, no remove()
hook-command-cgroup.ts:45 (launcher)  child.on('exit', (code) => process.exit(code ?? 1));        // a signal death becomes exit code 1
managed-background-shell-registry.ts complete(): resolves on launcher exit + pipe EOF; never checks the unit, never removes it</pre>
<div class="note">The supervisor's tests run against a fake unit, so none of this is exercised in CI. None of it is reachable in production yet: managed-context-worker builds ManagedToolExecutor without a supervisor, and every upstream gate (Hosted tool turn, ToolPublicationContract, Broker v3, session worker) still refuses <span class="mono">is_background</span>. These need fixing before the supervisor is wired.</div>`;
  cards['r2-03-supervisor-linux'] = page('The new supervisor on real Linux cgroup v2', 'core/cli dist of the head driven in a privileged container; candidate = 4 edits in hook-command-cgroup.ts, compiled from source', body, FOOT);
}

// r2-04 — stream capture
{
  const rows = fs.readFileSync(`${LX}/l9-head.log`, 'utf8').trim().split('\n').map((l) => JSON.parse(l.slice(9)));
  const first = fs.readFileSync(`${LX}/l9-head-first.log`, 'utf8').trim().split('\n').map((l) => JSON.parse(l.slice(9)));
  const all = [...first.filter((r) => r.mib === 256), ...rows].sort((a, b) => (a.arm === b.arm ? a.mib - b.mib : a.arm < b.arm ? -1 : 1));
  const timeline = fs.readFileSync(`${LX}/l10-head.log`, 'utf8').trimEnd();
  const body = `
<h2>L9 · supervisor onOutput → LocalShellStreamCapture.write, segment store persisting at 20 MiB/s</h2>
${table(['arm', 'output', 'peak RSS', 'process exited', 'capture done', 'capture', 'bytes / digest'], all.map((r) => [
    { t: r.arm === 'as-wired' ? 'as wired (write promise ignored)' : 'pipe paused until write resolves', cls: 'mono' },
    `${r.mib} MiB`,
    { t: `${r.peakRssMiB} MiB`, cls: r.arm === 'as-wired' ? 'bad' : 'ok' },
    `${(r.processExitMs / 1000).toFixed(1)} s`, `${(r.captureDoneMs / 1000).toFixed(1)} s`,
    r.captureStatus, `${r.streamByteLength} · ${r.streamDigestOk ? 'digest ok' : 'DIGEST BAD'}`,
  ]))}
<h2>L10 · a chatty process (20 lines over 2 s): what a reader of the current manifest sees</h2>
<pre>${esc(timeline)}</pre>
<div class="note">Design §Logs: "the producer pauses at pipe level … so memory stays bounded" and "a reader never waits for process exit". As built, nothing applies backpressure (memory grows with output size whenever storage is slower than the producer), and the manifest is refreshed only when a 512-segment page fills (512 MiB per stream) or at exit. LocalShellStreamCapture is not wired yet; its unit tests use a small segmentsPerPage, so the production cadence is never exercised.</div>`;
  cards['r2-04-stream-capture'] = page('Open-ended stream capture: correct bytes, but no backpressure and no live visibility', 'Linux container · real process under the supervisor · capture correctness checked against sha256 of the produced bytes', body, FOOT);
}

// r2-05 — mutation round 2
{
  const body = `
${table(['', 'mutants', 'killed', 'equivalent', 'unpinned (an input exists, no test holds it)'], [
    ['TypeScript', '49', { t: '27', cls: 'ok' }, '6 (T03 T22 T23 T30 T36 T37)', { t: '16 = 14 record-level + T59 T60', cls: 'bad' }],
    ['Java', '26', { t: '10', cls: 'ok' }, '— (known equivalents not rerun)', { t: '16 = 13 record-level + J57 J58 J59', cls: 'bad' }],
  ])}
<h2>Closed since round 1</h2>
<pre>T21/J21 stopReason-fits-state · T27/J27 quota iff · J41 non-text exitSignal (exit-signal-numeric) · T50/J50 receipt set-once
T51–T53 / J51–J53 stopRequested type, stop_requested needs it, start without it · T55–T56 / J55–J56 draining projections
T57 authority passes the stop request · T58 writer closure for child_run</pre>
<h2>Still unpinned (record-level, same conditions in both languages)</h2>
<pre>T02 start call may be absent   T04 dispatchId allowed        T07 receipt before start     T09 settled execution w/o receipt
T12 output version unchecked   T16 negative exitCode         T17 fractional exitCode (TS)  T18 17-char signal name
T24 start_failed with receipt  T25 start_failed, no attempt  T26 process_failed w/o receipt T32 ownerScopeId may change
T38 terminal not frozen        <span class="bad">T54/J54 a stop request may be cleared</span> (new rule, no fixture for clearing it)</pre>
<h2>New code with no test at all</h2>
<pre><span class="bad">J57</span> store passes stopRequested to the projection   (Java draining rows rest on it; S2 shows it works)
<span class="bad">J58 J59</span> server-side closure for child_run / outputRef  (ManagedExtensionRecordStoreTest is unchanged in this PR; S3 D2 shows it works)
<span class="bad">T59 T60</span> writer closure for outputRef / startReceiptRef  (only a missing commandRef is tested; S3 G shows both work)</pre>
<div class="note">The author's reply says ManagedExtensionRecordStoreTest covers the new closure branch; that file is unchanged in this PR and has no child_run case. The real stack confirms the behaviour today, but nothing in CI would catch a regression in J57–J59.</div>`;
  cards['r2-05-mutation'] = page('Mutation round 2: the new rules are pinned; store-level code is not', 'TS: child-run record / authority.child-run / extension-projection / authority.extension · Java: child-run contract + projection contract + record store tests · survivors classified by 200k-candidate replay', body, FOOT);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.mkdirSync(`${SP}/figs/out2`, { recursive: true });
for (const [name, html] of Object.entries(cards)) {
  fs.writeFileSync(`${SP}/figs/out2/${name}.html`, html);
  await pg.setContent(html);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent.slice(0, 60)));
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out2/${name}.png` });
  console.log(name, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
}
await browser.close();
