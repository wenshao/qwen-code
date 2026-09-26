#!/usr/bin/env python3
"""Round-2 evidence card for PR #12752 (head 9d949e8)."""
import importlib.util

OUT = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ee3d6caa-6091-40f9-ade7-5e9a755f3096/scratchpad/fig'
spec = importlib.util.spec_from_file_location('g', f'{OUT}/gen.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

runs = [
    ('macOS runs 1–6', '16 / 16 each', '108 · 121* · 113* · 98 · 98 · 99 s', '0 / 0'),
    ('CI · Hosted job, run 36235695294', '16 / 16', '1:27 (step); job 8m24s', 'n/a'),
]
rrow = ''.join(
    f'<tr><td>{a}</td><td class="ok nw">{b}</td><td>{c}</td><td>{d}</td></tr>'
    for a, b, c, d in runs)

fix = [
    ('F1', 'S0', '9 s stall before thaw, no mutant', 'held→release 12 359 ms', 'pass', 'ok'),
    ('F1', 'S9', '9 s stall + M09 (fenced dispatcher commits late answer)', 'held→release 12 431 ms', 'killed: the fenced record broke: SETTLED', 'ok'),
    ('F2', 'A1', 'adapter <code>observeRecord</code> skips attest · FG3 restart ×3', 'attest 1', 'killed 3 / 3: expected &lt;2&gt; but was &lt;1&gt;', 'ok'),
    ('F2', 'A2', '<b>production</b> <code>adoptObservation</code> skips attest · FG3 restart ×3', 'attest 1', 'killed 3 / 3: expected &lt;2&gt; but was &lt;1&gt;', 'ok'),
    ('F2', 'A123', 'no attestation after restart · FG3 restart ×3', 'attest 0', 'killed 3 / 3: expected &lt;2&gt; but was &lt;0&gt;', 'ok'),
    ('F2', 'A1T', 'A1 · FG4 takeover', 'attest 1', 'killed: expected &lt;2&gt; but was &lt;1&gt;', 'ok'),
    ('F2', 'A2T', 'A2 · FG4 takeover', 'attest 1', 'killed: expected &lt;2&gt; but was &lt;1&gt;', 'ok'),
    ('F2', 'A123T', 'A123 · FG4 takeover', 'attest 0', 'killed: expected &lt;2&gt; but was &lt;0&gt;', 'ok'),
    ('ctl', 'OLD', 'A2 · FG4 takeover on the <i>old</i> head <code>c6f197d</code>', '—', 'pass (survived: confirms the author\'s extra pin was needed)', 'warn'),
]
frow = ''.join(
    f'<tr><td class="dim">{a}</td><td class="mono">{b}</td><td>{c}</td>'
    f'<td class="mono">{d}</td><td class="{f}">{e}</td></tr>'
    for a, b, c, d, e, f in fix)

body = f"""
<h1>PR #12752 · round 2: both findings fixed at <code>9d949e8</code>, re-confirmed on merged main <code>d004e3d</code></h1>
<div class="sub">The delta over <code>c6f197d</code> is 3 test files + 2 design docs (no production, worker or
workflow change, so last round's bundle is still the right one) · macOS 26.6.2 arm64 · Zulu JDK 21.0.12 ·
the same harness, re-run on a fresh copy of the new head</div>
<h2>Stability of the new exact-count pins</h2>
<table><tr><th>Run</th><th>Gates</th><th>Time</th><th>Left workers / Brokers</th></tr>{rrow}</table>
<div class="dim" style="font-size:12.5px;margin-top:4px">* ran while a Checkstyle job shared the CPU</div>
<h2>The two fixes, driven by the same mutants that found the gaps</h2>
<table><tr><th></th><th>Arm</th><th>Change</th><th>Measured</th><th>Gate</th></tr>{frow}</table>
<h2>Everything from round 1, re-run on the new head</h2>
<table>
<tr><td>Pristine control</td><td class="ok">16 / 16</td></tr>
<tr><td>M01–M12 (the PR's table) + W1–W3 (bundled worker)</td><td class="ok">15 / 15 killed, each by its named gate; M01 now fails FG2 ×3 <i>and</i> FG3 worker-killed (4 / 4)</td></tr>
<tr><td>Full module Checkstyle rule set forced onto <code>src/test</code> (<code>includeTestSourceDirectory</code>, with a planted-violation control that it catches)</td>
<td class="ok">0 violations in the 12 new files <span class="dim">— the 9 hits are all in the pre-existing <code>DurableRuntimeRecoveryTest</code></span></td></tr>
</table>
<h2>After the merge: main <code>d004e3d</code>, which also carries #12730 (W0c-2)</h2>
<table>
<tr><td>The PR's 18 files at the squash commit vs the verified <code>9d949e8</code></td><td class="ok">byte-identical (<code>git diff --quiet</code>)</td></tr>
<tr><td>#12730 merged 12:11 UTC, after the PR's last CI run (10:24); it changed <code>RuntimeBrokerService</code>, <code>LocalProcessRuntimeProvisioner</code>, <code>HttpRuntimeTransport</code>, <code>RuntimeTransport</code>, <code>RuntimeProvisioner</code> (+1564 / −69 in 21 files)</td><td class="warn">the combination was first built by the post-merge push</td></tr>
<tr><td>Main's push CI, run 36242380534 · Hosted job</td><td class="ok">16 / 16 (1:35)</td></tr>
<tr><td>Local, bundle rebuilt from <code>d004e3d</code>: control · M01–M12 + W1–W3 · A1/A2/A123 on FG3 and FG4 · stall S0 / S9</td><td class="ok">16 / 16 · 15 / 15 killed · 6 / 6 killed · pass / killed</td></tr>
</table>
<div class="note">The attest count after an adopting <code>acquire</code> can only exceed 2 if an attestation fails and the
reconcile loop retries, so the exact pin does not depend on timing: all 7 full runs on the new head
(6 repeats + the control) held it, as did every mutant arm that did not target attestation.</div>
"""

with open(f'{OUT}/fig4.html', 'w', encoding='utf-8') as out:
    out.write(g.page('fig4', body))
print('ok')
