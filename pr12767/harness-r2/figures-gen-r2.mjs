// Round-2 evidence cards (head bc81319a). Numbers copied from h2/out and
// /Users/wenshao/git/pr12767-probe-h2/out-linux.
import * as fs from 'node:fs';

const MAC = JSON.parse(process.env.MAC_FUZZ ?? '{}');
const css = fs.readFileSync(new URL('./gen.mjs', import.meta.url), 'utf8').match(/const css = `([\s\S]*?)`;/)[1];
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;
const out = {};

out['r2-01-summary'] = page(
  'PR #12767 round 2 — head bc81319a against the round-1 head 2c4c6f40',
  'Both heads built and run side by side · macOS arm64 APFS (Node 24.18.1 / 22.23.2, load avg 56–65) · Linux 6.8 aarch64 container on ext4 (Node 22.23.2) · CI on bc81319a green',
  `<table>
<tr><th>Item</th><th>2c4c6f40 (round 1)</th><th>bc81319a (round 2)</th><th>How</th></tr>
<tr><td>F1 seal past an acknowledged tail</td><td class="num bad">seal ok + permanent anchor</td><td class="num ok">conflict, no seal/ written</td><td>real fs probe, macOS + Linux</td></tr>
<tr><td>F2 read-only prefix, 10 ms stall</td><td class="num bad">4 / 288 refused</td><td class="num ok">0 / 240</td><td rowspan="3">same Linux container, both heads interleaved, 60-segment streams</td></tr>
<tr><td>F2 read-only prefix, 40 ms stall</td><td class="num bad">62 / 95 refused</td><td class="num ok">0 / 46</td></tr>
<tr><td>F2 read-only prefix, 150 ms stall</td><td class="num bad">31 / 43 refused</td><td class="num ok">0 / 10</td></tr>
<tr><td>Unpinned guards M12 · M17 · M20 · M21</td><td class="num bad">4 survived</td><td class="num ok">4 killed</td><td>mutation matrix, PR suites as oracle</td></tr>
<tr><td>Bounded memory (M13)</td><td class="num bad">survived</td><td class="num ok">killed</td><td>new 80 MiB assertion; margin measured below</td></tr>
<tr><td>Read-only retry (M04)</td><td class="num ok">killed</td><td class="num warn">survived</td><td>rewritten race test no longer reaches it</td></tr>
<tr><td>Differential fuzz vs O1a ledger</td><td class="num ok">0 diff</td><td class="num ok">${MAC.diff ?? '—'} (macOS) · 5,716 ops (Linux), 0 diff</td><td>new lease between ops, read-only handles</td></tr>
<tr><td>Range fuzz</td><td class="num ok">0 wrong</td><td class="num ok">${MAC.range ?? '—'} (macOS) · 3,000 reads (Linux), 0 wrong</td><td>real resource store manifests + pages</td></tr>
<tr><td>SIGKILL crash fuzz</td><td class="num ok">0 violations</td><td class="num ok">${MAC.crash ?? '—'} (macOS) · 120 kills (Linux), 0 violations</td><td>child holds the lease, parent takes over</td></tr>
<tr><td>PR suites</td><td class="num ok">562 / 562</td><td class="num ok">564 / 564</td><td>store + fault + O1a contract</td></tr>
<tr><td>managed-runtime + writer lease</td><td class="num ok">1006 pass</td><td class="num ok">1007 pass · 1 load flake</td><td>the flake is an untouched lease test: 3/3 green on both heads</td></tr>
</table>
<p class="note">The production diff is 16 lines: the F2 re-stat (identical to the round-1 candidate) and an F1 check broadened to segment, published and corrupt markers past the requested count. Everything else is tests.</p>`,
);

out['r2-02-retry-and-mutants'] = page(
  'The read-only retry still matters, but no test reaches it any more',
  'The retry now covers only the seal race: the reader finishes its scan (segment k and its marker both absent), the writer publishes k and seals, then the reader reads a seal that does not match. Real processes, unmodified writer; the reader\'s preload now stalls after the marker lookup instead of the directory lookup.',
  `<table>
<tr><th>Linux, 3-segment streams, stall after <code>published-000k</code> ENOENT</th><th>bc81319a</th><th>bc81319a with the retry removed (M04)</th></tr>
<tr><td>40 ms</td><td class="num ok">0 / 316</td><td class="num bad">40 / 349 refused</td></tr>
<tr><td>150 ms</td><td class="num ok">0 / 114</td><td class="num bad">43 / 128 refused</td></tr>
</table>
<table>
<tr><th>Mutation at bc81319a (30 mutants)</th><th>PR suites</th><th>Note</th></tr>
<tr><td>M01–M03, M07–M23, M26, C01, C02, C04</td><td class="num ok">24 killed</td><td>incl. the four round-1 gaps and both new fixes</td></tr>
<tr><td>M04 drop the read-only retry</td><td class="num warn">survived</td><td>rewritten race test is absorbed by the re-stat; <span class="ok">killed</span> once the round-1 seal-race test (+45 lines) is added</td></tr>
<tr><td>M05 / M06 directory-sync retries</td><td class="num warn">survived</td><td>deferred by the author in the reply</td></tr>
<tr><td>C03 drop <code>corrupt</code> from the new seal check</td><td class="num dim">survived</td><td>redundant: a corrupt ordinal still has its segment directory or marker unless both were removed</td></tr>
<tr><td>M24 file fsync · M25 install pre-check</td><td class="num dim">survived</td><td>need power loss · unreachable while writes are serialized</td></tr>
</table>
<pre>  it('rechecks a prefix when the seal lands after the scan', …)
    fault.target = …/stream-stdout/published-00001      <span class="dim">// reader misses segment 1 and its marker</span>
    fault.missingOnce = () =&gt; publish(1) + seal(count=2)
    expect(await reader.prefix(request)).toMatchObject({ status: 'ok', result: { segmentCount: 2, sealed: true } })</pre>`,
);

out['r2-03-memory'] = page(
  'The new bounded-memory assertion: margin measured',
  '<code>expect(peakBuffers - initialBuffers).toBeLessThan(80 MiB)</code> on the 100 MiB (25 × 4 MiB) test. Real vitest runs with the test patched only to report <code>initialBuffers</code> (restored afterwards); the replica is the same loop outside vitest.',
  `<table>
<tr><th>Condition</th><th>Node</th><th>Runs</th><th>arrayBuffers growth</th><th>vs 80 MiB</th></tr>
<tr><td>vitest, whole file, <code>--max-old-space-size=3072</code> (as CI)</td><td class="num">22.23.2</td><td class="num">20</td><td class="num ok">14.6–15.6 MiB</td><td class="num ok">≥ 5.1×</td></tr>
<tr><td>vitest, whole file, <code>--max-old-space-size=3072</code></td><td class="num">24.18.1</td><td class="num">20</td><td class="num ok">14.9 MiB</td><td class="num ok">5.4×</td></tr>
<tr><td>vitest, this test only (<code>-t</code>)</td><td class="num">24.18.1</td><td class="num">5</td><td class="num ok">23.5–31.5 MiB</td><td class="num ok">≥ 2.5×</td></tr>
<tr><td>replica outside vitest, Linux container</td><td class="num">22.23.2</td><td class="num">30</td><td class="num ok">23.0–31.9 MiB</td><td class="num ok">≥ 2.5×</td></tr>
<tr><td>replica outside vitest, macOS</td><td class="num">22.23.2</td><td class="num">40</td><td class="num ok">23.1–24.0 MiB</td><td class="num ok">≥ 3.3×</td></tr>
<tr><td>replica outside vitest, macOS</td><td class="num">24.18.1</td><td class="num">40</td><td class="num warn">56.1–64.1 MiB</td><td class="num warn">≥ 1.25×</td></tr>
<tr><td>retention mutant (every published buffer kept)</td><td class="num">22 / 24</td><td class="num">3 + 3</td><td class="num bad">103–124 MiB</td><td class="num ok">fails, as it should</td></tr>
</table>
<p class="note">In every vitest configuration the assertion has at least 2.5× headroom and the retention mutant fails it; the M13 mutant is killed in the matrix. The 56–64 MiB range quoted in the round-1 deep verification reproduces only outside vitest on Node 24; growth moves in 8 MiB steps (two 4 MiB chunks).</p>`,
);

for (const [name, html] of Object.entries(out)) fs.writeFileSync(new URL(`./${name}.html`, import.meta.url), html);
console.log(Object.keys(out).join(' '));
