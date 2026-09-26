#!/usr/bin/env python3
"""Evidence cards for PR #12804 from results.jsonl and the run logs."""
import html
import json
import os
import re
import xml.etree.ElementTree as ET

SP = os.environ["SP"]
OUT = f"{SP}/fig"
os.makedirs(OUT, exist_ok=True)

SHORT = {
    "aControlRunInstallsTheContextAndRunsInItsDirectory": "control",
    "aLostInstallationAnswerIsReplayedUnderTheSameOperation(Action)[1]": "install lost DROP",
    "aLostInstallationAnswerIsReplayedUnderTheSameOperation(Action)[2]": "install lost RESET",
    "aLostInstallationAnswerIsReplayedUnderTheSameOperation(Action)[3]": "install lost DELAY",
    "aLostActivationAnswerIsRetriedAgainstTheSameGate": "activation lost",
    "aLostManagedAttestationBlocksRecoveryWithoutARelaunch(Attester)[1]": "attest lost (provisioner)",
    "aLostManagedAttestationBlocksRecoveryWithoutARelaunch(Attester)[2]": "attest lost (service)",
    "aBrokerKilledDuringManagedStartupStaysBlockedAfterRestart": "Broker killed in startup",
    "aReplacementWorkerRunsNothingUntilItsOwnContextIsInstalled": "worker killed after install",
    "aRestartedBrokerReplaysTheInstallationOnTheAdoptedWorker(Window)[1]": "Broker killed after install (INSTALLED)",
    "aRestartedBrokerReplaysTheInstallationOnTheAdoptedWorker(Window)[2]": "Broker killed after install (ACTIVATED)",
    "aRemovedContextDirectoryIsRefusedWithoutAFallback": "pin: context dir removed",
}
ORDER = list(SHORT.values())

CSS = """
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mute:#8b949e;
--ok:#3fb950;--bad:#f85149;--warn:#d29922;--acc:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;padding:26px 30px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mute);margin:0 0 18px;font-size:13.5px}
table{border-collapse:collapse;width:100%;margin:0 0 16px;background:var(--panel)}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{color:var(--mute);font-weight:600;font-size:13px;background:#1c2128}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
code,.mono{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}.warn{color:var(--warn);font-weight:600}
.note{border-left:4px solid var(--acc);background:var(--panel);padding:10px 14px;margin:6px 0 0}
.note.caution{border-color:var(--warn)}
pre{background:var(--panel);border:1px solid var(--line);padding:10px 12px;margin:0 0 14px;
font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
.add{color:var(--ok)}.del{color:var(--bad)}.h{color:var(--acc)}
h2{font-size:15px;margin:16px 0 8px;color:var(--acc)}
.chip{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:1px 3px 1px 0;font-size:12.5px}
.chip.bad{border-color:#6e2a28;color:#ffa198;font-weight:500}
.chip.bad.extra{border-style:dashed;color:#e3b341;border-color:#9e6a03}
"""


def page(title, sub, body):
    return (f"<!doctype html><html><head><meta charset=utf-8><title>{html.escape(title)}</title>"
            f"<style>{CSS}</style></head><body><h1>{html.escape(title)}</h1>"
            f"<p class=sub>{sub}</p>{body}</body></html>")


def records():
    return [json.loads(l) for l in open(f"{SP}/harness/results.jsonl")]


def fg5_times(xml):
    root = ET.parse(xml).getroot()
    return {SHORT[tc.get("name")]: float(tc.get("time")) for tc in root.findall("testcase")}


def summary(log):
    text = open(log).read()
    classes = re.findall(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+), Time elapsed: ([\d.]+) s -- in com\.alibaba\.qwen\.code\.runtimebroker\.(\w+)", text)
    total = re.search(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$", text, re.M)
    wall = re.search(r"cpu (\d+:\d+\.\d+) total", text)
    return classes, total, wall.group(1) if wall else "?"


def card1():
    head = f"{SP}/wt/packages/sdk-java/runtime-broker/target/surefire-reports/TEST-com.alibaba.qwen.code.runtimebroker.ContextInstallationFaultGateTest.xml"
    merge = f"{SP}/wt-merge/packages/sdk-java/runtime-broker/target/surefire-reports/TEST-com.alibaba.qwen.code.runtimebroker.ContextInstallationFaultGateTest.xml"
    th, tm = fg5_times(head), fg5_times(merge)
    c1, t1, w1 = summary(f"{SP}/gates-run1.log")
    c2, t2, w2 = summary(f"{SP}/gates-merge-node22.log")
    rows = ""
    for (a, b) in zip(c1, c2):
        rows += (f"<tr><td class=mono>{a[5]}</td><td class=n>{a[0]}</td><td class='n ok'>{int(a[0])-int(a[1])-int(a[2])}/{a[0]}</td>"
                 f"<td class=n>{float(a[4]):.1f} s</td><td class='n ok'>{int(b[0])-int(b[1])-int(b[2])}/{b[0]}</td><td class=n>{float(b[4]):.1f} s</td></tr>")
    rows += (f"<tr><th>total</th><th class=n>{t1.group(1)}</th><th class='n ok'>{t1.group(1)}/{t1.group(1)} &middot; 0 fail</th><th class=n>wall {w1}</th>"
             f"<th class='n ok'>{t2.group(1)}/{t2.group(1)} &middot; 0 fail</th><th class=n>wall {w2}</th></tr>")
    per = "".join(f"<tr><td>{g}</td><td class=n>{th[g]:.2f} s</td><td class=n>{tm[g]:.2f} s</td></tr>" for g in ORDER)
    body = f"""
<table><tr><th>Class (<code>mvn -Pfault-gates test</code>)</th><th class=n>tests</th>
<th class=n>PR head bfd6ed25<br>Node 24.18.1</th><th class=n>time</th>
<th class=n>merge 7da36284 (main a44af0a0)<br>Node 22.23.2</th><th class=n>time</th></tr>{rows}</table>
<div style="display:flex;gap:16px">
<table style="flex:1.1"><tr><th>FG5 gate (<code>ContextInstallationFaultGateTest</code>)</th><th class=n>PR head</th><th class=n>merge</th></tr>{per}</table>
<table style="flex:1"><tr><th colspan=2>Other checks (PR head)</th></tr>
<tr><td><code>mvn test</code> (default)</td><td><span class=ok>365 run, 0 fail</span>, 1 skipped; no fault-gate class runs</td></tr>
<tr><td><code>mvn checkstyle:check</code></td><td><span class=ok>0 violations</span></td></tr>
<tr><td>checkstyle forced over <code>src/test</code></td><td><span class=ok>0</span> in the 6 changed test files (9 pre-existing, all in <code>DurableRuntimeRecoveryTest</code>)</td></tr>
<tr><td>after all 21 runs (incl. failing mutants)</td><td><span class=ok>0</span> <code>managed-runtime-worker</code>, <span class=ok>0</span> Broker JVMs, <span class=ok>0</span> <code>runtime-broker-fault-gate*</code> temp dirs</td></tr>
<tr><td>merge vs main</td><td>clean <code>merge-tree</code>; the diff is exactly the PR's 10 files (+837/&minus;110)</td></tr>
<tr><td>worker chunk PR vs merge</td><td>identical after chunk-name normalisation (45,403 B)</td></tr>
</table></div>
<div class=note>The PR's own "Tested on" marks macOS &#9888;&#65039;. On macOS 26 arm64 (JDK 21.0.12, Maven 3.9.16), all 28 gates pass at the PR head and on the merge with current main. The host was busy the whole time (load average about 25 on 10 cores).</div>"""
    open(f"{OUT}/01-gates-macos.html", "w").write(page(
        "PR #12804: Stage F fault gates on macOS",
        "Real Broker JVMs, real bundled worker (<code>dist/cli.js managed-runtime-worker</code>), real HTTP through <code>FaultProxy</code>, "
        "real process kills, H2 database; bundles built locally from each tree", body))


CLAIMS = {
    "J1-acquire-failure-marks-ready": ("A failed transport acquire still marks the Session READY", ["install lost DROP", "install lost RESET", "install lost DELAY", "activation lost"]),
    "J2-install-lost-answer-is-installed": ("installContext treats a lost answer as installed", ["install lost DROP", "install lost RESET", "install lost DELAY"]),
    "J3-activation-ignores-failure": ("activateWorkspace ignores a failed exchange", ["activation lost"]),
    "J4-managed-startup-not-blocked-on-retryable": ("A managed startup is not blocked on a retryable failure", ["attest lost (service)"]),
    "J5-resource-handle-no-longer-blocks-restart": ("A persisted managed resource handle no longer blocks a restart", ["Broker killed in startup"]),
    "W1-runs-without-context-in-mount-root": ("worker: runs a tool without an installed, activated context, in the mount root", ["worker killed after install", "Broker killed after install (INSTALLED)", "pin: context dir removed"]),
    "W2-every-session-activated": ("worker: treats every Session as activated", ["Broker killed after install (INSTALLED)"]),
    "W3-verifies-again-instead-of-replay": ("worker: verifies every installation again instead of replaying", ["install lost DROP", "install lost RESET", "install lost DELAY", "activation lost", "Broker killed after install (INSTALLED)", "Broker killed after install (ACTIVATED)"]),
    "W4-installs-without-verifying": ("worker: installs without verifying the context directory", ["install lost DROP", "install lost RESET", "install lost DELAY", "activation lost", "Broker killed after install (INSTALLED)", "Broker killed after install (ACTIVATED)"]),
    "W5-refuses-with-another-409-code": ("worker: refuses a tool with another 409 code", ["worker killed after install", "Broker killed after install (INSTALLED)", "pin: context dir removed"]),
}
EXTRA = {
    "T1-awaitReply-reverted": "rig: <code>BrokerProcess.awaitReply</code> reverted to the old 120 s poll (full suite)",
    "T2-createRequest-not-forwarded": "rig: <code>RecoverableProcessProvisioner</code> stops forwarding <code>createRequest</code> (full suite)",
    "T3-release-does-not-close-gate": "rig: MANAGED <code>release</code> no longer closes the worker gate",
    "P1-refusal-settles-not_started": "pin control: Broker settles a <code>managed_context_unavailable</code> refusal as <code>not_started</code> (the fix the design names)",
}


def gates(rec):
    return [SHORT.get(c["test"], c["cls"] + "." + c["test"]) for c in rec["failed"]]


def card2():
    recs = {r["mutant"]: r for r in records()}
    rows = ""
    for i, (k, (desc, claim)) in enumerate(CLAIMS.items(), 1):
        r = recs[k]
        got = gates(r)
        chips = "".join(f"<span class='chip bad{'' if g in claim else ' extra'}'>{html.escape(g)}</span>" for g in sorted(got, key=ORDER.index))
        ok = set(claim) <= set(got)
        verdict = "<span class=ok>killed &#10003;</span>" if got and ok else "<span class=bad>MISMATCH</span>"
        kind = "Java" if k[0] == "J" else "worker"
        rows += f"<tr><td class=n>{i}</td><td>{kind}</td><td>{html.escape(desc)}</td><td>{chips}</td><td>{len(claim)} &sube; {len(got)}</td><td>{verdict}</td></tr>"
    xrows = ""
    for k, desc in EXTRA.items():
        r = recs[k]
        got = gates(r)
        chips = "".join(f"<span class='chip bad'>{html.escape(g)}</span>" for g in sorted(got, key=lambda g: ORDER.index(g) if g in ORDER else 99)) or "<span class=warn>none &mdash; survives</span>"
        xrows += f"<tr><td>{desc}</td><td class=n>{r['run']}</td><td>{chips}</td></tr>"
    body = f"""
<table><tr><th>#</th><th>patched</th><th>Mutation from the PR's table (each applied alone)</th><th>FG5 gates that failed (red = named by the PR; amber dashed = also failed)</th><th>claim &sube; observed</th><th></th></tr>{rows}</table>
<h2>Extra probes (not in the PR's table)</h2>
<table><tr><th>Mutation</th><th class=n>tests run</th><th>Gates that failed</th></tr>{xrows}</table>
<div class=note>All 10 of the PR's mutations are killed, each by every gate the PR names (J1 and J2 fail more gates than claimed, shown in amber). The five worker mutations patch the built chunk
<code>managed-runtime-attestation-worker-*.js</code>, which no CI check re-runs mutated. T1/T2 leave FG1&ndash;FG4 at 16/16, so the shared-rig edits change nothing there, and FG5 needs both.
T1 fails the kill gates outright: the gate's 45 s wait expires before the old 120 s call timeout. P1 shows the pin flips when the design's fix lands; every other gate stays green.</div>"""
    open(f"{OUT}/02-mutation-matrix.html", "w").write(page(
        "PR #12804: mutation matrix, independently re-run",
        "Exact-string mutations (match count asserted = 1) in a fresh copy of the module or of <code>dist/</code>; "
        "<code>mvn -o -Pfault-gates test -Dtest=ContextInstallationFaultGateTest</code> unless noted; PR head bfd6ed25", body))


def card3():
    recs = {r["mutant"]: r for r in records()}
    spec = [
        ("S1a-slow-base", "PR as is", "9 s", "Broker killed in startup"),
        ("S1b-slow-J5", "J5: resource handle no longer blocks a restart", "9 s", "Broker killed in startup"),
        ("J5-resource-handle-no-longer-blocks-restart", "J5 (from the matrix)", "none", "all 12 FG5"),
        ("S1c-slow-candidate", "candidate guard", "9 s", "Broker killed in startup"),
        ("S1d-candidate", "candidate guard", "none", "all 12 FG5"),
        ("S1e-candidate-J5", "candidate guard + J5", "none", "Broker killed in startup"),
    ]
    rows = ""
    for k, what, delay, scope in spec:
        r = recs[k]
        got = gates(r)
        res = (f"<span class=ok>{r['run']}/{r['run']} pass</span>" if not got else
               f"<span class=bad>fails</span>: <span class=mono>{html.escape(r['failed'][0]['msg'][:78])}</span>")
        judge = {
            "S1a-slow-base": "<span class=warn>passes, but the first Broker had already answered warm before the kill (see S1c)</span>",
            "S1b-slow-J5": "<span class=bad>false green: the regression survives</span>",
            "J5-resource-handle-no-longer-blocks-restart": "<span class=ok>killed at normal speed</span>",
            "S1c-slow-candidate": "<span class=ok>slow host now fails loudly</span>",
            "S1d-candidate": "<span class=ok>no regression</span>",
            "S1e-candidate-J5": "<span class=ok>still kills J5</span>",
        }[k]
        rows += f"<tr><td class=mono>{k.split('-')[0]}</td><td>{what}</td><td class=n>{delay}</td><td>{scope}</td><td>{res}</td><td>{judge}</td></tr>"
    body = f"""
<table><tr><th></th><th>Tree</th><th class=n>worker start delay</th><th>Gates run</th><th>Result</th><th>Reading</th></tr>{rows}</table>
<h2>Candidate (test only, +5 lines in <code>ContextInstallationFaultGateTest</code>)</h2>
<pre><span class=h>@@ aBrokerKilledDuringManagedStartupStaysBlockedAfterRestart @@</span>
         held.awaitHeld(FaultGateRig.WAIT);
<span class=add>+        // On a slow host the first Broker's own startup deadline (4 x the
+        // operation lease) can block the binding before the kill, and the
+        // gate would pass without testing the restart.
+        assertFalse(warming.isDone(), "the first Broker answered warm "
+                + "before it was killed");</span>

         rig.killBroker(first);</pre>
<div class="note caution">The delay comes from a <code>node</code> wrapper on <code>PATH</code> that sleeps before <code>exec</code>ing the real node, for <code>managed-runtime-worker</code> only.
The managed startup deadline is 4 &times; the 2 s operation lease = 8 s. When the worker needs longer, the first Broker blocks the binding itself before the gate kills it, so the gate no longer tests
the restart path and J5 passes. This is the author's deferred round-3 suggestion, now measured. The worker normally starts in well under 1 s, so this is unlikely, but when it happens the gate passes wrongly rather than failing.</div>"""
    open(f"{OUT}/03-slow-start-probe.html", "w").write(page(
        "PR #12804: startup-kill gate vs a slow worker start",
        "<code>-Dtest=ContextInstallationFaultGateTest#aBrokerKilledDuringManagedStartupStaysBlockedAfterRestart</code>; module copies under <code>packages/sdk-java/</code>; PR head bfd6ed25", body))


if __name__ == "__main__":
    card1(); card2(); card3()
    print(os.listdir(OUT))
