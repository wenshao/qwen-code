// Round-3 evidence cards for PR #13265 (head 210847dd0e). Numbers are copied
// from rig3/out, rig3/diff, rig3/mut and /Users/wenshao/pr13265-rig/out.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const LX = '/Users/wenshao/pr13265-rig/out';
const require = createRequire(`${SP}/wt-pr3/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = fs.readFileSync(`${SP}/figs/render.mjs`, 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 round 3 · heads 210847dd0e and 9b8d87536a (hosted-workspace-tool-turn.ts only) · macOS: Spring jar + native MySQL 8.4.7 + built core/cli dist over the HTTP store · Linux: privileged container (kernel 6.8, cgroup v2, cgroupns private), node 22.23.2, the head\'s core/cli dist';
const resultLine = (file) => JSON.parse(fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')).slice(9));
const tally = (file, label) => JSON.parse(fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`[${label}]`)).slice(label.length + 3));
const cards = {};

// r3-01 — status of earlier findings + what holds
{
  const s2 = resultLine(`${SP}/rig3/out/s2-chain.log`);
  const s6 = resultLine(`${SP}/rig3/out/s6-hosted-child-runs.log`);
  const body = `
${table(['item', 'status at 210847dd0e', 'evidence'], [
    ['B1 CI red (env guard, attach ENOENT)', { t: 'fixed — CI green', cls: 'ok' }, 'b6dc42a8fa; all checks pass at head except the web-shell smoke, still running'],
    ['F1–F4 (closure, NPE, re-attach receipt, draining)', { t: 'still hold', cls: 'ok' }, { html: `S1 refused + nothing written · S2 ${s2.commits} commits, ${s2.mismatches} mismatches · S3 closure refused locally and by Java · S4 numeric exitSignal → 409, no NPE` }],
    ['TS/Java differential (200,000)', { t: '0 crashes, 0 real disagreements', cls: 'ok' }, '216 disagreements, all the known NFC case (#12837)'],
    ['projection differential', { t: '7,404/7,404 identical', cls: 'ok' }, '59 of them draining'],
    ['Java verify on MySQL 8.4.7', { t: 'green', cls: 'ok' }, '555 unit (1 skipped) · 52/52 ITs · Checkstyle 0 · SpotBugs 0'],
    ['G1 attach() always undefined', { t: 'not fixed, and copied into create()', cls: 'bad' }, 'card 2'],
    ['G2 terminate race · G4 signal evidence', { t: 'not fixed', cls: 'bad' }, 'card 3'],
    ['G3 registry ends on launcher exit', { t: 'not fixed; bounded EOF wait widens it', cls: 'bad' }, 'card 3'],
    ['G5 stream capture backpressure / visibility', { t: 'not fixed (still unwired)', cls: 'warn' }, '256 MiB → 289 MiB RSS as wired vs 69 MiB paused; reader sees rev 1, 0 bytes until exit'],
  ])}
<h2>S6 · the new HostedChildRunSession, driven through the real HTTP store into Spring + MySQL</h2>
<pre>${s6.mismatches} mismatches between authority / Java row / public task across 5 Shells · settleExited twice → second is a no-op (0 tx)
30 concurrent advanceOutput → 30 fulfilled, 30 tx, revisions serialized to 33 · cold reopen equal</pre>
<div class="note">The record pipeline is solid. What remains is in the newly wired process code (cards 2–3) and in the orchestrator's edge semantics (card 4).</div>`;
  cards['r3-01-status'] = page('Round 3: record contract holds, CI fixed; the process path does not work yet', 'Everything earlier rounds raised, re-checked at the new head', body, FOOT);
}

// r3-02 — create() regression + membership race
{
  const named = JSON.parse(fs.readFileSync(`${LX}/l12-create-named-head3.log`, 'utf8'));
  const c3 = ['touch; exit 0', 'touch; sleep 0.3', 'touch; (sleep 30 &); exit 0'].map((l) => [l, tally(`${LX}/l13-cand3.log`, l), tally(`${LX}/l13-cand4.log`, l)]);
  const body = `
<h2>H1 · create() now refuses every named unit (head)</h2>
<pre>hook-command-cgroup.ts:81   if (unitName !== undefined &amp;&amp; (unitName.includes('/') || unitName.includes(''))) throw …   // added by the R2-26 fix
hook-command-cgroup.ts:120  if (unitName.includes('/') || unitName.includes('')) return undefined;                          // G1, unchanged
'anything'.includes('') === true</pre>
${table(['real delegated root /sys/fs/cgroup/h3 (head dist)', 'result'], [
    ['HookCommandCgroup.create(root) — unnamed (H2 hooks)', { t: `ok (${named.unnamedCreate}…)`, cls: 'ok' }],
    ['create(root, "qwen-bg-call-1") / "x" / "qwen-bg-abc.def_1"', { t: `${named['named:qwen-bg-call-1']} · ${named['named:x']} · ${named['named:qwen-bg-abc.def_1']}`, cls: 'bad' }],
    ['ManagedChildRunSupervisor.start({ unitName: "qwen-bg-call-1", … })', { t: named.supervisorStart, cls: 'bad' }],
  ])}
<div class="note bad">a13e7db55d injects the supervisor at worker boot whenever QWEN_MANAGED_HOOK_CGROUP_ROOT is set, so on exactly the hosts H3 targets every background start settles not_started "requires a delegated Linux cgroup v2 directory". The supervisor tests mock HookCommandCgroup.create, so nothing in CI runs it.</div>
<h2>H2 · with only the NUL fix: start() misreports commands that already ran (30 trials each)</h2>
${table(['command', 'NUL fix only: refused as isolation', '…of which actually ran', '…unit left with a live process', 'candidate patch: started'], c3.map(([l, a, b]) => [
    { t: l, cls: 'mono' },
    { t: `${a.refusedAsIsolation}/30`, cls: a.refusedAsIsolation ? 'bad' : 'ok' },
    { t: `${a.refusedButRan}`, cls: a.refusedButRan ? 'bad' : 'ok' },
    { t: `${a.liveMembersInLeftUnit}`, cls: a.liveMembersInLeftUnit ? 'bad' : 'ok' },
    { t: `${b.started}/30`, cls: 'ok' },
  ]))}
<pre>managed-child-run-supervisor.ts prove(): polls cgroup.procs for the launcher pid — a command that finishes first has already left it
→ executor settles not_started ("requires a delegated Linux cgroup v2 directory") for a process that ran, possibly leaving a live child in an unheld unit
→ and the process object's exit listener is attached only after the proof, so a positive proof for a fast command would lose its exit evidence</pre>`;
  cards['r3-02-create-and-membership'] = page('Background Shells cannot start on a real cgroup v2 host', 'Linux container, delegated root /sys/fs/cgroup/h3 · head dist, head + NUL fix, and the round-3 candidate patch', body, FOOT);
}

// r3-03 — supervisor and registry remaining
{
  const h14 = tally(`${LX}/l14-cand3.log`, 'L14 terminate x20');
  const c14 = tally(`${LX}/l14-cand4.log`, 'L14 terminate x20');
  const h15 = tally(`${LX}/l14-cand3.log`, 'L15 inherited pipes');
  const c1 = resultLine(`${LX}/l1-cand4.log`);
  const body = `
${table(['case (real cgroup v2)', 'head + NUL fix', 'round-3 candidate patch'], [
    ['L14 terminate(500) with one TERM-ignoring member, ×20', { t: `null (unproven) ${h14.nullEvidence}/20, unit dir left ${h14.unitLeft}/20`, cls: 'bad' }, { t: `evidence ${c14.evidence}/20, left ${c14.unitLeft}`, cls: 'ok' }],
    ['L4 command dies by kill -KILL $$ / kill -SEGV $$', { t: 'exitCode 1, exitSignal null (both)', cls: 'bad' }, { t: `${c1.L4_selfkill.exitSignal} / ${c1.L4_segv.exitSignal}`, cls: 'ok' }],
    ['L5 attach() a live unit by name', { t: 'undefined', cls: 'bad' }, { t: 'the unit', cls: 'ok' }],
    ['L15 natural exit; a background child keeps the pipes open', { html: `<span class="bad">hold released after ${(h15.msUntilHoldReleased / 1000).toFixed(1)} s</span> (new bounded EOF grace), ${h15.liveMembers} live member, streams capped, finalize(success)` }, { t: 'unchanged (registry design)', cls: 'warn' }],
    ['L3 natural exit; setsid daemon with stdio detached', { t: 'hold released at once, daemon alive in the unit', cls: 'bad' }, { t: 'unchanged (registry design)', cls: 'warn' }],
    ['L8 plain natural exit', { t: 'unit dir left; supervisor map never forgotten', cls: 'warn' }, { t: `unchanged (size ${c1.L8.supervisorSize} after one run)`, cls: 'warn' }],
    ['L6 second start with a unit name in use', { t: '"requires a delegated Linux cgroup v2 directory"', cls: 'warn' }, { t: 'unchanged', cls: 'warn' }],
  ])}
<pre>candidate-r3.patch — 2 files, 6 edits:
  hook-command-cgroup.ts          NUL check at both sites · launcher writes 'joined' on fd 3 after joining · launcher re-raises a signal death
                                  · terminate() waits for the unit to empty after cgroup.kill
  managed-child-run-supervisor.ts prove() accepts 'joined' · the process object (exit listener) is created before the proof
macOS: hooks + supervisor 1167 tests, background/context-worker/env-guard 779 tests, tsc clean · Linux: 90/90 fast starts, 20/20 terminate evidence</pre>
<div class="note">The H2 hook runner reads the same fd-3 channel only for 'unavailable', so the extra 'joined' line is compatible. The registry items (L3, L15, L8) need a design call: end a Shell on unit evidence, not on the launcher's exit; cap or block instead of releasing the hold while members live; remove the unit afterwards.</div>`;
  cards['r3-03-supervisor-registry'] = page('Supervisor and registry: three one-line defects, one design gap', 'Linux container · NUL-fixed head vs the round-3 candidate patch (compiled from source)', body, FOOT);
}

// r3-04 — HostedChildRunSession semantics
{
  const log = fs.readFileSync(`${SP}/rig3/out/s6-hosted-child-runs.log`, 'utf8').split('\n');
  const stepLine = (id, label) => JSON.parse(log.find((l) => l.startsWith('[step]') && l.includes(`"id":"${id}"`) && l.includes(`"label":"${label}"`)).slice(7));
  const pub = JSON.parse(log.find((l) => l.startsWith('[publish twice')).slice('[publish twice, same bytes] '.length));
  const s6 = resultLine(`${SP}/rig3/out/s6-hosted-child-runs.log`);
  const body = `
${table(['call', 'result on the real stack', 'note'], [
    ['h-3: admit → dispatchStarted → requestStop → settleStopRequested', { t: stepLine('h-3', 'settleStopRequested').outcome.replace('REFUSED ', 'refused: '), cls: 'bad' }, 'cancelled now needs a settled execution, which needs a receipt'],
    ['h-3: … → settleFailed(start_failed, started:false)', { t: `${stepLine('h-3', 'settleFailed(start_failed)').ts} — the user\'s stop shows as a failed task`, cls: 'warn' }, 'the only way to end a stop requested before start'],
    ['h-4: attach twice with the same receipt content', { t: stepLine('h-4', 'attach (same receipt content)').outcome.replace('REFUSED ', 'refused: '), cls: 'bad' }, { html: `publishing the same bytes twice gives two ids (${esc(pub.first.slice(0, 8))}… / ${esc(pub.second.slice(0, 8))}…, digest equal) — refs are not content-addressed, so attach() can never keep a receipt across a retry or a re-attach` }],
    ['h-1: attach → advanceOutput ×3', { t: s6.sequences['h-1'].slice(2, 6).join(' → '), cls: 'warn' }, 'every live revision flips running ↔ waiting; the public task reads waiting right after attach'],
    [{ html: '9b8d87536a acceptBackgroundShell(): <span class="mono">attach()</span> first, its own replay check (existing tool.receipt) after' }, { t: 'a re-entry after the attach commit fails at attach() — the replay branch below it is unreachable', cls: 'bad' }, 'the receipt also carries occurredAt: Date.now(), so even identical facts publish a new ref (h-4 shows identical content is refused already)'],
    ['h-1: advanceOutput back to an older manifest', { t: 'accepted', cls: 'warn' }, 'advance-only is left to the publisher (R1-19)'],
  ])}
<h2>Stream capture (still unwired) — G5 re-measured on the head</h2>
<pre>${esc(fs.readFileSync(`${LX}/l9-head3.log`, 'utf8').trim().split('\n').map((l) => { const r = JSON.parse(l.slice(9)); return `${r.arm.padEnd(9)} ${r.mib} MiB → peak RSS ${r.peakRssMiB} MiB · capture ${r.captureStatus}, digest ok: ${r.streamDigestOk}`; }).join('\n'))}
${esc(fs.readFileSync(`${LX}/l10-head3.log`, 'utf8').trim().split('\n').slice(-2).join('\n'))}</pre>
<div class="note">Since 9b8d87536a the Hosted tool turn calls HostedChildRunSession once child_run is enabled. It stays disabled, and the Broker v3 gate (RuntimeBrokerService.java:548) and ToolPublicationContract.java:155 still refuse is_background, so none of this reaches users today. The pre-start stop and the receipt reuse are decisions the orchestrator needs before the record producer lands.</div>`;
  cards['r3-04-orchestrator'] = page('HostedChildRunSession edge semantics, and the capture re-measured', 'S6 on the macOS real stack · L9/L10 in the Linux container (NUL-fixed head dist)', body, FOOT);
}

// r3-05 — mutation round 3
{
  const body = `
${table(['', 'mutants', 'killed', 'equivalent', 'unpinned'], [
    ['TypeScript', '49', { t: '37 (round 2: 27)', cls: 'ok' }, '5 (T03 T30 T63 T64 T65)', { t: '7 = T02 T04 T18 T54 T62 + T59 T60', cls: 'bad' }],
    ['Java', '30', { t: '20 (round 2: 10 of 26)', cls: 'ok' }, '3 (J63 J64 J65)', { t: '7 = J02 J04 J18 J54 J62 + J57 J59', cls: 'bad' }],
  ])}
<h2>Newly killed by the author's witnesses</h2>
<pre>TS   T07 T09 T12 T16 T17 T26 T32 T38 · new terminal rules T61 T66
Java J07 J09 J12 J16 J26 J32 J38 · new terminal rules J61 J66 · J58 server closure (commitsAndProjectsAChildRunChain)
(T24/T25 and J24/J25 were dropped: the start_failed rule they targeted was rewritten; T64/T65, J64/J65 replace them)</pre>
<h2>Still unpinned — smallest input each</h2>
<pre><span class="bad">T62/J62</span> cancelled + not_started_proven + stop_requested is refused only by "cancelled needs settled execution"; no fixture holds it
         (the random walk missed it; a targeted input proves it: head refuses, mutant accepts — it is exactly the pre-start-stop shape)
T54/J54 a stop request may be cleared                    T02/J02 run without executionCallId (execution null)
T04/J04 run.dispatchId allowed                           T18/J18 17-character signal name
T59 T60 writer closure for outputRef / startReceiptRef   J57 store passes stopRequested into the projection · J59 server closure for outputRef</pre>
<div class="note">T63–T65 / J63–J65 are equivalent: once every failed run must carry a fitting stop reason, the start_failed / process / quota clauses imply the ending-line rule. T62/J62 is not — it is the one rule that decides the pre-start-stop question on card 4.</div>`;
  cards['r3-05-mutation'] = page('Mutation round 3: most gaps closed; the pre-start-stop rule is the one left', 'Same suites as round 2 · survivors classified by 200k replay plus targeted inputs', body, FOOT);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.mkdirSync(`${SP}/figs/out3`, { recursive: true });
for (const [name, html] of Object.entries(cards)) {
  fs.writeFileSync(`${SP}/figs/out3/${name}.html`, html);
  await pg.setContent(html);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent.slice(0, 60)));
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out3/${name}.png` });
  console.log(name, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
}
await browser.close();
