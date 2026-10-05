#!/usr/bin/env python3
# Usage: mutate.py <mutant|none> [parallelism]  -- applies one mutation to wt-mut's connector, runs the 3 connector test classes, prints RESULT
import subprocess, sys, re, json, time, os
S = "/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad"
W = f"{S}/wt-mut"
F = "packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/harness/QwenHostedHarnessConnector.java"
P = f"{W}/{F}"
name = sys.argv[1]
par = sys.argv[2] if len(sys.argv) > 2 else ""
subprocess.run(["git", "-C", W, "checkout", "--", F], check=True)
s = open(P).read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n < count or n == 0:
        raise SystemExit(f"MUTANT-APPLY-FAIL {name}: pattern found {n}x: {old[:80]!r}")
    s = s.replace(old, new, count)

if name == "none":
    pass
elif name == "M1-computeIfAbsent":
    a = s.index("                ? load(session, true) : attachments.get(key);")
    b = s.index("        if (session.workspace() != null\n                && !actions.approvalMode")
    s = s[:a] + "                ? load(session, true)\n                : attachments.computeIfAbsent(key, ignored -> loadExisting\n                        ? load(session, false)\n                        : create(session));\n" + s[b:]
elif name == "M2-client-synchronized":
    a = s.index("        // A ReentrantLock, not a monitor: the first build blocks on the")
    b = s.index("        clientLock.lock();\n        try {\n")
    s = s[:a] + "        synchronized (this) {\n" + s[b + len("        clientLock.lock();\n        try {\n"):]
    rep("            return current;\n        } finally {\n            clientLock.unlock();\n        }\n    }", "            return current;\n        }\n    }")
elif name == "M3-no-inlock-reread":
    rep("                attached = attachments.get(key);\n                if (attached == null) {", "                if (attached == null) {")
elif name == "M4-bare-remove-release":
    rep("                attachmentLocks.compute(key, (ignored, held) ->\n                        --held.holders == 0 ? null : held);", "                attachmentLocks.remove(key);")
elif name == "M5-release-success-only":
    rep("            } finally {\n                slot.lock.unlock();\n                attachmentLocks.compute(key, (ignored, held) ->\n                        --held.holders == 0 ? null : held);\n            }\n",
        "            } finally {\n                slot.lock.unlock();\n            }\n            attachmentLocks.compute(key, (ignored, held) ->\n                    --held.holders == 0 ? null : held);\n")
elif name == "M6-no-unlock":
    rep("                slot.lock.unlock();\n", "")
elif name == "M7-no-inlock-put":
    rep("                            : create(session);\n                    attachments.put(key, attached);\n", "                            : create(session);\n")
elif name == "M8-close-no-clear":
    rep("        attachments.clear();\n        pendingRecovery.clear();", "        pendingRecovery.clear();")
elif name == "M9-no-holders-inc":
    rep("                        next.holders++;\n", "")
elif name == "M10-never-reclaim":
    rep("--held.holders == 0 ? null : held);", "--held.holders == 0 ? held : held);")
elif name == "M11-global-lock":
    rep("attachmentLocks.compute(key,", "attachmentLocks.compute(new AttachmentKey(\"\", \"\"),", 2)
elif name == "M12-client-no-recheck":
    rep("            current = client;\n            if (current == null) {", "            if (current == null) {")
else:
    raise SystemExit(f"unknown mutant {name}")
open(P, "w").write(s)
d = subprocess.run(["git", "-C", W, "diff", "--stat", "--", F], capture_output=True, text=True).stdout.strip()
if name != "none" and not d:
    raise SystemExit(f"MUTANT-APPLY-FAIL {name}: empty diff")
subprocess.run(["git", "-C", W, "diff", "--", F], stdout=open(f"{S}/mutants/{name}{'-p'+par if par else ''}.diff", "w"))
env = dict(os.environ, JAVA_HOME=os.path.expanduser("~/Install/jdk21"), TZ="UTC")
env["PATH"] = env["JAVA_HOME"] + "/bin:" + env["PATH"]
cmd = ["mvn", "-B", "-o", f"-Dmaven.repo.local={S}/m2/shared", "-Dcheckstyle.skip",
       "-f", f"{W}/packages/sdk-java/managed-agent-server/pom.xml", "test",
       "-Dtest=HostedHarnessCreateOrLoadPinningTest,QwenHostedHarnessConnectorTest,QwenHostedHarnessNewSessionRegressionTest"]
if par:
    cmd.append(f"-DargLine=-Djdk.virtualThreadScheduler.parallelism={par}")
t0 = time.time()
log = f"{S}/mutants/{name}{'-p'+par if par else ''}{os.environ.get('TAG','')}.log"
r = subprocess.run(cmd, env=env, stdout=open(log, "w"), stderr=subprocess.STDOUT)
el = time.time() - t0
txt = open(log).read()
summ = re.findall(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$", txt, re.M)
failing = sorted(set(re.findall(r"\[ERROR\]\s+(\w+Test\.\w+)(?::\d+)?", txt)))
compiled = "COMPILATION ERROR" not in txt
total = summ[-1] if summ else None
res = {"mutant": name, "parallelism": par or "default", "exit": r.returncode, "compiled": compiled,
       "summary": total, "failing": failing, "elapsedS": round(el, 1),
       "verdict": ("CONTROL-PASS" if r.returncode == 0 else "CONTROL-FAIL") if name == "none" else ("KILLED" if r.returncode != 0 and compiled else ("SURVIVED" if r.returncode == 0 else "NOCOMPILE"))}
subprocess.run(["git", "-C", W, "checkout", "--", F], check=True)
print("RESULT " + json.dumps(res))
