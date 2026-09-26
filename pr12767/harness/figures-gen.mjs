// Evidence cards for the PR 12767 report. Every number below is copied from
// the harness outputs in ../h/out and /Users/wenshao/git/pr12767-probe-h/out-linux.
import * as fs from 'node:fs';

const css = `
*{box-sizing:border-box}body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.card{width:1360px;padding:28px 32px 30px}
h1{font-size:22px;margin:0 0 4px;font-weight:600}
.sub{color:#8b949e;margin:0 0 18px;font-size:14px}
table{border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:14px}
th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px;margin:6px 0 14px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
.note{border-left:3px solid #58a6ff;padding:4px 12px;color:#c9d1d9;margin:10px 0 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#79c0ff}
h2{font-size:16px;margin:14px 0 4px;color:#c9d1d9}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;
const out = {};

out['01-matrix'] = page(
  'PR #12767 — real-environment verification matrix',
  'head 2c4c6f40 · store exercised as compiled <code>packages/core/dist</code> JS · macOS arm64 APFS (Node 24.18.1, load avg 12–48) · Linux 6.8 aarch64 container on ext4 overlay (Node 22.23.2)',
  `<table>
<tr><th>Check</th><th>What it does</th><th>macOS</th><th>Linux</th></tr>
<tr><td>PR's own suites</td><td>store + fault + O1a contract tests</td><td class="num ok">562 / 562</td><td class="num dim">CI Test (ubuntu) green</td></tr>
<tr><td>Related regressions</td><td>all of <code>src/managed-runtime</code> + session-writer-lease</td><td class="num ok">1006 pass · 10 skip</td><td class="num dim">—</td></tr>
<tr><td>Differential fuzz</td><td>disk store vs O1a in-memory ledger; random publish / seal / prefix, new Session lease between ops, fresh read-only handles</td><td class="num ok">17,071 ops · 0 diff</td><td class="num ok">5,677 ops · 0 diff</td></tr>
<tr><td>Range fuzz</td><td>manifests + pages published by the real resource store; pages & ref bodies; old open revision; both handles</td><td class="num ok">9,000 reads · 0 wrong</td><td class="num ok">3,000 reads · 0 wrong</td></tr>
<tr><td>SIGKILL crash fuzz</td><td>child holds the lease and publishes; killed at a random moment; parent takes over and checks every invariant</td><td class="num ok">250 kills · 0 violations</td><td class="num ok">120 kills · 0 violations</td></tr>
<tr><td>Real ENOSPC</td><td>80 MB APFS image filled to 22 MiB free</td><td class="num ok">not acked · no residue · retry ok</td><td class="num dim">—</td></tr>
<tr><td>Longest tokens</td><td>128-char capture + stream IDs, ordinal 65535</td><td class="num ok">ok (429-char path)</td><td class="num ok">ok (377-char path)</td></tr>
<tr><td>F1 tail-segment seal</td><td>acknowledged tail segment directory removed, marker kept, then seal(count−1)</td><td class="num bad">seal ok (ledger: conflict)</td><td class="num bad">seal ok (ledger: conflict)</td></tr>
<tr><td>F2 reader race</td><td>read-only prefix on a growing stream, reader stalled 10–300 ms between two stats</td><td class="num bad">55/62 refused @150 ms</td><td class="num bad">98/182 refused @10 ms</td></tr>
<tr><td>Mutation matrix</td><td>26 targeted mutants of the store, PR's suites as oracle</td><td class="num warn">17 / 26 killed</td><td class="num dim">—</td></tr>
<tr><td>Candidate patch</td><td>+14/−6 production, +258 tests (F1, F2, 7 pinning tests)</td><td class="num ok">570 pass · 25/28 killed</td><td class="num ok">F1/F2 closed</td></tr>
<tr><td>Windows</td><td colspan="3" class="warn">Not run: the fork-Actions probe push was not authorized in this session; PR CI skips the Windows leg by design.</td></tr>
</table>
<p class="note">Crash fuzz also saw 77 (macOS) / 16 (Linux) kills land after a segment became durable but before its receipt reached the parent, and 5 / 1 for seals: in every case identical retries replayed the original receipts. Lease takeover after SIGKILL: p50 94 ms, max 317 ms on macOS.</p>`,
);

out['02-f1-tail-seal'] = page(
  'F1 — seal accepts a count that drops an acknowledged tail segment',
  'publish ordinals 0,1,2 (all acknowledged) → remove <code>segment-00002/</code>, keep <code>published-00002</code> → reopen with a new lease → seal(count=2). Same result on macOS APFS and Linux ext4.',
  `<div class="two"><div>
<h2>PR head 2c4c6f40</h2>
<pre>publish 0 / 1 / 2                  ok / ok / ok
rm -r stream-stdout/segment-00002   (marker published-00002 kept)

read-only prefix                   refused digest_mismatch   <span class="dim">← store knows it is corrupt</span>
ledger.seal(count=2), same history refused conflict
<span class="bad">disk seal(count=2)                 ok {segmentCount:2, byteLength:11}</span>
  → seal/ + sealed-stream-… anchor written (permanent)
prefix after seal                  refused digest_mismatch
publish(2) identical retry         refused digest_mismatch</pre>
</div><div>
<h2>Candidate (+8 lines in seal)</h2>
<pre>publish 0 / 1 / 2                  ok / ok / ok
rm -r stream-stdout/segment-00002

read-only prefix                   refused digest_mismatch
ledger.seal(count=2), same history refused conflict
<span class="ok">disk seal(count=2)                 refused conflict</span>
  → no seal written

middle ordinal removed (control)   PR and candidate: conflict
tail dir AND its marker removed    ok on both (outside the model)</pre>
</div></div>
<pre>        const entries = await readdir(stream);
        const names = entries.filter((name) =&gt; /^segment-[0-9]{5}$/.test(name));
        if (
          names.length !== fields.segmentCount ||
          names.some((name) =&gt; Number(name.slice(8)) &gt;= fields.segmentCount) ||
<span class="ok">          entries.some((name) =&gt; /^published-[0-9]{5}$/.test(name) &amp;&amp; Number(name.slice(10)) &gt;= fields.segmentCount)</span>
        ) {</pre>
<p class="note">seal() counts <code>segment-NNNNN</code> directories but never the publication markers that exist to detect exactly this removal, so a seal can contradict a receipt the store already returned. The candidate's new test fails on the PR head and passes with the fix.</p>`,
);

const r = (a, b, cls) => `<td class="num ${cls}">${a}</td>`;
out['03-f2-reader-race'] = page(
  'F2 — a read-only prefix reports a healthy growing stream as corrupt',
  'Writer process publishes 60 small segments per stream then seals, unmodified. A separate reader process polls <code>prefix</code> on a read-only handle. The only change to the reader is a <code>--import</code> preload that sleeps N ms after an <code>lstat</code> of a segment directory returns ENOENT.',
  `<table>
<tr><th>Platform</th><th>Reader stall</th><th>No-retry mutant</th><th>PR head (retry once)</th><th>Candidate (re-stat after marker)</th></tr>
<tr><td>Linux</td><td class="num">none</td><td class="num dim">—</td><td class="num ok">0 / 10,517 (3-seg streams)</td><td class="num dim">—</td></tr>
<tr><td>Linux</td><td class="num">40 ms, 3-seg streams</td><td class="num bad">182 / 413</td><td class="num dim">—</td><td class="num dim">—</td></tr>
<tr><td>Linux</td><td class="num">10 ms</td><td class="num dim">—</td><td class="num bad">98 / 182 refused</td><td class="num ok">0 / 97</td></tr>
<tr><td>Linux</td><td class="num">40 ms</td><td class="num dim">—</td><td class="num bad">59 / 114 refused</td><td class="num ok">0 / 70</td></tr>
<tr><td>Linux</td><td class="num">150 ms</td><td class="num dim">—</td><td class="num bad">17 / 52 refused</td><td class="num ok">0 / 42</td></tr>
<tr><td>Linux</td><td class="num">untargeted busy loop 10 ms / 15 ms</td><td class="num dim">—</td><td class="num ok">0 / 234</td><td class="num ok">0 / 102</td></tr>
<tr><td>macOS</td><td class="num">40 ms, 3- and 30-seg</td><td class="num bad">13 / 405</td><td class="num ok">0 / 1,725 · 0 / 511</td><td class="num dim">—</td></tr>
<tr><td>macOS</td><td class="num">150 ms</td><td class="num dim">—</td><td class="num bad">55 / 62 refused</td><td class="num ok">0 / 65</td></tr>
<tr><td>macOS</td><td class="num">300 ms</td><td class="num dim">—</td><td class="num bad">33 / 38 refused</td><td class="num ok">0 / 5 (each poll followed the stream to its seal)</td></tr>
</table>
<pre>reader: lstat segment-000k → ENOENT     … stall …     lstat published-000k → present  ⇒ "missing published segment"
writer:                    rename segment-000k, fsync, link published-000k
PR:  retry once → the next publication opens the same window at ordinal k+1 → refused managed_tool_result_digest_mismatch
fix: the writer always installs the directory before its marker, so after seeing the marker stat the directory once more:
<span class="ok">      if (!(await this.publishedMarker(stream, ordinal))) return undefined;
      if (!(await maybeStat(directory))) { …markCorrupt…; throw new CorruptToolResultError(…) }</span></pre>
<p class="note">All refusals are <code>managed_tool_result_digest_mismatch</code>, i.e. corruption, on streams whose bytes verify. The window needs a stall at one specific await, so the natural rate is low (0 under untargeted contention). But retry-once only bounds the once-per-stream seal race: every new segment reopens this window. The writable handle is unaffected.</p>`,
);

const muts = [
  ['M05', 'publish retry: skip the stream-directory sync before re-acknowledging', 'survived', 'killed', 'test arms the fault for two attempts; the third acks with no successful sync'],
  ['M06', 'ensureDirectory: skip the parent sync when the child exists', 'survived', 'killed', 'test targets the root, whose anchor install syncs it anyway; capture dir never synced'],
  ['M12', 'readRange: skip receipt-vs-page digest comparison', 'survived', 'killed', 'real run: returns "alpha" for a page pinning sha256("omega")'],
  ['M13', 'publish: retain every published buffer', 'survived', 'survived', 'scale test records RSS but asserts nothing'],
  ['M17', 'existingStream: ignore anchors when the capture dir is gone', 'survived', 'killed', 'real run: acknowledged segment replaced by other bytes'],
  ['M20', 'enqueue: skip the per-operation lease check', 'survived', 'killed', 'real run: keeps acknowledging after the transcript changed'],
  ['M21', 'openWritable: accept a lease of another Session', 'survived', 'killed', 'real run: session-b lease opens and writes session-a'],
  ['M24', 'writeAndSync: skip the file fsync', 'survived', 'survived', 'needs power loss to observe'],
  ['M25', 'installDirectory: replace instead of refusing an existing ordinal', 'survived', 'survived', 'unreachable while one writer is serialized'],
  ['C01', 'candidate: drop the re-stat', '—', 'killed', ''],
  ['C02', 'candidate: ignore markers past the seal', '—', 'killed', ''],
];
out['04-mutation'] = page(
  'Mutation matrix — PR suites 17 / 26 killed, candidate 25 / 28',
  'One mutant at a time in <code>local-managed-tool-result-store.ts</code>, oracle = the PR\'s store + fault suites; source restored byte-identical after the run. Killed on both: M01–M04, M07–M11, M14–M16, M18, M19, M22, M23, M26.',
  `<table><tr><th>Mutant</th><th>Change</th><th>PR suites</th><th>+ candidate tests</th><th>Why it matters</th></tr>
${muts.map(([id, d, a, b, w]) => `<tr><td>${id}</td><td>${d}</td><td class="num ${a === 'survived' ? 'bad' : 'dim'}">${a}</td><td class="num ${b === 'killed' ? 'ok' : 'warn'}">${b}</td><td>${w}</td></tr>`).join('\n')}
</table>
<p class="note">M12, M17, M20 and M21 were each re-run against the compiled store on a real filesystem (macOS and Linux): the PR build refuses or throws, the mutant build silently succeeds. The production code is right; nothing pins it. M05/M06 are tests whose titles claim what they do not enforce.</p>`,
);

out['05-scale'] = page(
  'Scale and cost model — 4 MiB segments from an incremental source',
  'Compiled store, real files. macOS numbers taken at load average 28–48 (other sessions on the host); Linux container on the same host (Docker VM), numbers indicative only.',
  `<table>
<tr><th>Measure</th><th>macOS 100 MiB</th><th>macOS 1 GiB</th><th>Linux 100 MiB</th></tr>
<tr><td>publish (throughput)</td><td class="num">1.67 s (60 MiB/s)</td><td class="num">20.5 s (50 MiB/s)</td><td class="num">0.34 s (298 MiB/s)</td></tr>
<tr><td>prefix, writable / read-only</td><td class="num">173 / 172 ms</td><td class="num">2,273 / 1,443 ms</td><td class="num">188 / 196 ms</td></tr>
<tr><td>seal</td><td class="num">210 ms</td><td class="num">1,556 ms</td><td class="num">198 ms</td></tr>
<tr><td>64 KiB read via body.pages</td><td class="num">5–6 ms</td><td class="num">10 ms</td><td class="num">9–15 ms</td></tr>
<tr><td>64 KiB read via body.ref</td><td class="num">81–85 ms</td><td class="num warn">781–825 ms</td><td class="num">130–132 ms</td></tr>
<tr><td>peak RSS / ArrayBuffers</td><td class="num">183 / 112 MiB</td><td class="num ok">274 / 140 MiB</td><td class="num">199 / 112 MiB</td></tr>
</table>
<table>
<tr><th>prefix after every publish (a polling producer)</th><th>polls</th><th>total prefix time</th></tr>
<tr><td>100 MiB (25 segments)</td><td class="num">25</td><td class="num">2.2 s</td></tr>
<tr><td>400 MiB (100 segments)</td><td class="num">100</td><td class="num warn">43.4 s</td></tr>
</table>
<p class="note">Memory stays bounded: 10× the data costs 1.5× the RSS. The I/O cost is the tradeoff the PR states (prefix and seal rescan, body.ref hashes the whole file), and it is quadratic if O1c polls prefix per segment: 4× the data, 20× the time. O1c should build from publish receipts and prefer body.pages for large outputs.</p>`,
);

for (const [name, html] of Object.entries(out)) fs.writeFileSync(new URL(`./${name}.html`, import.meta.url), html);
console.log(Object.keys(out).join(' '));
