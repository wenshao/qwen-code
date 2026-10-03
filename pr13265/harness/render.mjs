// Renders the PR #13265 evidence cards (HTML -> PNG with Playwright).
// Every number on a card is copied from a run log under rig/out or rig/mut.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const require = createRequire(`${SP}/wt-pr/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
*{box-sizing:border-box} body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{width:1360px;padding:28px 34px 30px;background:#0d1117}
h1{font-size:25px;margin:0 0 4px;font-weight:650} .sub{color:#8b949e;font-size:14.5px;margin-bottom:18px}
h2{font-size:16px;margin:20px 0 8px;color:#79c0ff;font-weight:600}
table{border-collapse:collapse;width:100%;font-size:13.5px} th{color:#8b949e;text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid #30363d}
td{padding:6px 8px;border-bottom:1px solid #21262d;vertical-align:top} td.mono,span.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950} .bad{color:#f85149} .warn{color:#d29922} .mut{color:#8b949e} .b{font-weight:650}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.45;white-space:pre;overflow:hidden;margin:6px 0}
.note{border-left:4px solid #d29922;background:#161b22;padding:10px 14px;margin-top:16px;font-size:14px;line-height:1.5}
.note.ok{border-color:#3fb950;color:#e6edf3} .note.bad{border-color:#f85149;color:#e6edf3}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.foot{color:#8b949e;font-size:12px;margin-top:14px}
`;

function page(title, sub, body, foot) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
}
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 head 817383760e · base 1a4de7486a · Spring jar + MariaDB 10.11.18 (docker) + built packages/core/dist over the HTTP session store · macOS arm64, JDK 21, Node 24';

const cards = {};

// 01 — production gate and chains
{
  const s2 = fs.readFileSync(`${SP}/rig/out/s2-chain.log`, 'utf8').split('\n').filter((l) => l.startsWith('[commit]') || l.startsWith('[refused]'));
  const rows = s2.map((l) => {
    const j = JSON.parse(l.slice(l.indexOf('{')));
    if (l.startsWith('[refused]')) return [{ t: j.id, cls: 'mono' }, { t: j.label, cls: 'mono' }, { t: 'refused', cls: 'warn' }, { t: j.error.replace('ManagedSessionConflictError: ', ''), cls: 'mono mut' }, { t: j.unchanged ? 'journal unchanged' : 'CHANGED', cls: j.unchanged ? 'ok' : 'bad' }];
    return [{ t: j.id, cls: 'mono' }, { t: j.label, cls: 'mono' }, { t: `rev ${j.rev}`, cls: 'mono' }, { t: `${j.ts}  |  ${j.java}`, cls: 'mono' }, { t: j.same ? 'TS = Java' : 'MISMATCH', cls: j.same ? 'ok' : 'bad' }];
  });
  const body = `
<div class="grid"><div><h2>S1 · shipped enabled-domain list (no override)</h2>
<pre>head  commit child_run → <span class="ok">ManagedSessionRecordError: domain child_run is
      registered but not enabled for submission.</span>
      journal before/after: tx 2 / resources 3 / records 0  (unchanged)
base  commit child_run → <span class="ok">domain child_run has no Stage H record body.</span>
      journal unchanged</pre></div>
<div><h2>Inertness of the shipped artifacts (base → head)</h2>
<pre>packages/core/dist   + managed-child-run-record.js
                     ~ managed-extension-projection.js (+1 import, +child_run entry)
                     ~ contracts/*.fixtures.json, + 2 test files, git-commit.js
MANAGED_SESSION_ENABLED_DOMAINS        <span class="ok">identical</span> (8 domains)
server jar entries   576 → 576, <span class="ok">570 identical CRC</span>; 6 changed, all
                     ManagedExtensionProjection* / ManagedExtensionRecords*</pre></div></div>
<h2>S2 · child_run enabled in this process only (as the PR's own authority test does) → real HTTP store → Spring + MariaDB</h2>
${table(['record', 'revision', 'commit', 'authority task view | Java row (task_kind task_state/runtime_state)', 'check'], rows)}
<div class="note ok">15 commits, <b>0 mismatches</b> between the authority, the Java row and <span class="mono">GET /v1/agents/sessions/{id}/tasks</span> (3 tasks, kind <span class="mono">background_shell</span>); 15 <span class="mono">task.updated</span> events; refusals leave the journal untouched; a cold reopen by a second writer rebuilds identical views. Repeated on the trial merge jar (PR + main 576689d073 + #13217 7f4d6aa299): same 15/15, 0 mismatches.</div>`;
  cards['01-real-stack-chain'] = page('child_run on the real stack: inert when shipped, consistent when enabled', 'S1 production gate · artifact diff · S2 three background-Shell chains (life to exit, stop request, Runtime loss + re-attach)', body, FOOT);
}

// 02 — resource closure
{
  const body = `
<div class="sub" style="margin-top:-8px">Design §Resource closure: "The Java store commits a body only with every resource the body names … The writer checks each reference before publishing the body … No resource kind is exempted."</div>
${table(['case', 'what the writer commits', 'authority (TS)', 'Java store', 'afterwards'], [
    ['A', { t: 'child_run admit, commandRef never published', cls: 'mono' }, { t: 'no local check — publishes', cls: 'warn' }, { t: '409 "A referenced Managed Session resource is missing."', cls: 'mono' }, { t: 'writer STOPPED: next valid commit refused locally', cls: 'bad' }],
    ['B', { t: 'child_run admit, commandRef of another Session', cls: 'mono' }, { t: 'no local check — publishes', cls: 'warn' }, { t: '409 resource missing', cls: 'mono' }, { t: 'writer STOPPED', cls: 'bad' }],
    ['C', { t: 'mcp_operation admit, argsRef never published', cls: 'mono' }, { t: 'refused before publish: "resource does not exist"', cls: 'ok' }, { t: 'never called', cls: 'mut' }, { t: 'next valid commit: COMMITTED', cls: 'ok' }],
    ['D', { t: 'child_run chain, 3 ghost refs left out of the commit\'s resource list', cls: 'mono' }, { t: 'no local check', cls: 'warn' }, { t: '200 ×4 — admit, dispatch, attach, output', cls: 'bad' }, { t: 'row "background_shell running rev4"; read of commandRef / startReceiptRef / outputRef → "does not exist"; cold reopen accepts', cls: 'bad' }],
    ['E', { t: 'mcp_operation, ghost argsRef left out (local checks off)', cls: 'mono' }, { t: '(disabled for the probe)', cls: 'mut' }, { t: '409 resource missing', cls: 'ok' }, { t: 'server-side closure holds for MCP', cls: 'ok' }],
  ])}
<h2>Where the domain lists stop short</h2>
<pre>packages/core/src/managed-runtime/managed-session-authority.ts:1890   verifyExtensionResources(): mcp_configuration, mcp_operation,
                                                                      hook_registration, hook_execution — no child_run (nor monitor_run)
ManagedExtensionRecordStore.java:344  applyRevision(): nested-ref check for the same four domains only
managed-session-authority.child-run.test.ts:132-166   RECEIPT_1, MANIFEST_1/2 and args-shell-1 are never published — the suite passes
                                                      only because neither check covers child_run</pre>
<div class="note">Not reachable in production today (child_run is disabled). Before enablement both lists need <span class="mono">child_run</span> (and <span class="mono">monitor_run</span>, which H3 also enables); the authority test then has to publish its refs.</div>`;
  cards['02-resource-closure'] = page('child_run references sit outside both closure checks', 'S3 · five fresh Sessions on the head stack (child_run enabled in-process) · MCP as the control', body, FOOT);
}

// 03 — differential + NPE
{
  const body = `
<div class="grid"><div><h2>TS/Java differential through the built artifacts</h2>
<pre>candidates            200,000  (fixtures, every single-field substitution,
                               random walks, successor pairs)
  record bodies       119,981   both valid 8,590 · both invalid 110,228
  successor pairs      80,019   accepted by both 10,839
TS crashes                  0
Java crashes            <span class="bad">1,706</span>   all NullPointerException, all a non-string
                               exitSignal (9, 0, true, false, {}, [])
other disagreements       290   all the known NFC gap U+105D2 U+0307 in the
                               shared id() (JDK 21 vs Node 24 Unicode; #12837)
remaining                   <span class="ok">0</span></pre></div>
<div><h2>S4 · the same body sent to the real server (bypass writer)</h2>
<pre>exitSignal: 9      POST /transactions:commit <span class="bad">500</span> ×3 (client retries)
                   "The Managed Agent request failed."
exitSignal: true   POST /transactions:commit <span class="bad">500</span> ×3
exitSignal: "term" POST /transactions:commit <span class="ok">409</span> ×1
                   "childRun.exitSignal must be an uppercase signal name."
all three: journal unchanged, writer stopped</pre></div></div>
<h2>Server log (head jar)</h2>
<pre>ERROR c.a.q.c.m.api.ApiExceptionHandler : Managed Agent request failed
java.lang.NullPointerException: Cannot invoke "java.lang.CharSequence.length()" because "this.text" is null
    at java.util.regex.Pattern.matcher(Pattern.java:1180)
    at ...store.ManagedExtensionRecords.requireChildRun(<span class="bad">ManagedExtensionRecords.java:688</span>)
    at ...store.ManagedExtensionRecordStore.applyRevision(ManagedExtensionRecordStore.java:340)

688:  || EXIT_SIGNAL.matcher(exitSignal.textValue()).matches(),     textValue() is null for a non-string node;
785:  accepts() catches InvalidRecordException only, so isChildRunStart / isChildRunSuccessor throw too</pre>
<div class="note">TypeScript refuses these bodies before sending, so only a writer that bypasses the TS validator can reach the 500. Fix: <span class="mono">exitSignal.isTextual() &amp;&amp; EXIT_SIGNAL.matcher(…)</span>, plus a fixture with a numeric <span class="mono">exitSignal</span> (the Java contract test asserts <span class="mono">InvalidRecordException</span>, so it would have caught this).</div>`;
  cards['03-differential-npe'] = page('TS and Java agree everywhere except a Java NPE on a non-string exitSignal', '200,000-candidate differential (built TS dist vs compiled Java classes) · S4 on the real server', body, FOOT);
}

// 04 — re-attach + deployment order
{
  const body = `
<h2>Re-attaching the same process under a later generation</h2>
${table(['revision after recovery_blocked / runtime_lost / outcome_unknown (gen 1, receipt R3)', 'authority (TS)', 'Java store (bypass writer)'], [
    [{ t: 'running_attached under binding-2 / gen 2, startReceiptRef = R3 (same process, same receipt)', cls: 'mono' }, { t: 'refused: "cannot follow its revision 4"', cls: 'bad' }, { t: '409 "cannot follow its revision 4"', cls: 'bad' }],
    [{ t: 'running_attached under binding-2 / gen 2, startReceiptRef = R3b (new receipt)', cls: 'mono' }, { t: 'COMMITTED → degraded / ready', cls: 'ok' }, { t: 'row degraded / ready', cls: 'ok' }],
  ])}
<pre>design §Records    "a start receipt is set once and changes only with a new Runtime binding under a later generation"
design §Recovery   "the replacement re-attaches a surviving background process by its cgroup unit — the unit exists,
                    the recorded command digest and start receipt match"; every background Shell otherwise stays blocked
code  managed-child-run-record.ts:324-330   rebuilt ? before.startReceiptRef === null || !same(before, after) : setOnce(...)
fixture  "rebuild-new-receipt" valid; no fixture pins the same-receipt refusal (mutants T39 / J39 survive)</pre>
<div class="note">The Monitor rebuild rule (a fresh watch, so a new receipt) was carried over to a Shell, which is never rebuilt, only re-attached. The contract accepts a new start receipt and refuses the original one. Needs a decision before enablement.</div>
<h2>S5 · writer before server (design: Reader gating; H0c open question 7)</h2>
<pre>old jar (base)  admit / dispatch / attach of shell-1   → 200 ×3; 0 extension rows; public task list []
                (authority sees background_shell running)
swap to PR jar on the same database, second writer reopens, commits the next valid revision:
                → <span class="bad">409 "The first revision of child_run record shell-1 must open its run."</span>
                → writer stopped; an unrelated new Shell afterwards is refused; public task list still []</pre>
<div class="note ok">Exactly the hazard the design describes; it confirms why <span class="mono">child_run</span> must stay out of <span class="mono">MANAGED_SESSION_ENABLED_DOMAINS</span> until the server has been deployed first.</div>`;
  cards['04-reattach-and-order'] = page('Re-attach receipt rule, and the server-first deployment order', 'S2 shell-3 + S4 (Java-only) · S5 base jar → PR jar on one MariaDB database', body, FOOT);
}

// 05 — mutation
{
  const ex = fs.readFileSync(`${SP}/rig/mut/ts/minimal-examples.txt`, 'utf8').trim().split('\n');
  const pairs = [];
  for (let i = 0; i < ex.length; i += 2) pairs.push([ex[i].replace(/\s+\[.*$/, ''), ex[i + 1].trim()]);
  const body = `
${table(['', 'mutants', 'killed by the PR suites', 'equivalent (no input among 200k tells them apart)', 'unpinned (an input exists; no fixture holds it)'], [
    ['TypeScript', '41', { t: '18', cls: 'ok' }, '7  (T03 T22 T23 T30 T36 T37 T41)', { t: '16', cls: 'bad' }],
    ['Java', '38', { t: '17', cls: 'ok' }, '6  (J03 J22 J23 J30 J36 J37)', { t: '15', cls: 'bad' }],
  ])}
<h2>Smallest input that tells each unpinned TS mutant apart (patch against the fixture template; the 15 Java gaps are the same conditions, T17 has no Java twin)</h2>
<pre>${pairs.map(([id, p]) => `${esc(id.padEnd(40))} ${esc(p.length > 118 ? p.slice(0, 115) + '…' : p)}`).join('\n')}</pre>
<div class="note">Today TS and Java agree on all of these (card 03), but the shared fixture file is the cross-language contract: any of these 15–16 conditions could drift on one side without CI noticing. Several have a fixture named for them that also breaks a second rule (stop-mismatch and process-failed-no-receipt carry handler_unavailable on a failed run; quota-mismatch keeps an unproven intent execution; receipt-before-start has no runtime), so the run block or a neighbour rule refuses it first and the named rule is never isolated.</div>`;
  cards['05-mutation'] = page('Mutation testing of both validators against the PR suites', 'TS: managed-child-run-record / authority.child-run / extension-projection tests · Java: ManagedChildRunRecordContractTest + ManagedExtensionProjectionContractTest', body, FOOT);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.mkdirSync(`${SP}/figs/out`, { recursive: true });
for (const [name, html] of Object.entries(cards)) {
  fs.writeFileSync(`${SP}/figs/out/${name}.html`, html);
  await pg.setContent(html);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent.slice(0, 60)));
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out/${name}.png` });
  console.log(name, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
}
await browser.close();
