# VERIFICATION RIG ONLY (PR #13682 R2, head 7105fb1e): TS mutants on the #13332 merge resolution. Core mutants rebuild core (the CLI tests import core's dist) and run
# the core metadata test plus the CLI hosted-harness test; CLI mutants run the CLI test only. Files restored byte-for-byte.
import subprocess, sys, os, re, json, time
W = "/root/v13682/h3"; OUT = "/root/v13682/out/mut3"; os.makedirs(OUT, exist_ok=True)
A = "packages/core/src/managed-runtime/managed-session-authority.ts"
H = "packages/cli/src/serve/hosted-harness-session.ts"
MUT = [
 ("T8", "#13332 order lost: content spreads after the envelope again", A,
  "            ...content,\n            operationId: command.commandId,\n            revision,\n            previousRecordRef: previous?.recordRef ?? null,\n",
  "            operationId: command.commandId,\n            revision,\n            previousRecordRef: previous?.recordRef ?? null,\n            ...content,\n"),
 ("T9", "merge resolution takes main side: request.content (watermark-bearing content dropped)", A,
  "            ...content,\n            operationId: command.commandId,", "            ...request.content,\n            operationId: command.commandId,"),
]
ENV = dict(os.environ, CI="1", NODE_OPTIONS="--max-old-space-size=6144")
def sh(cmd, cwd, log):
    with open(log, "a") as fh:
        return subprocess.run(cmd, shell=True, cwd=cwd, env=ENV, stdout=fh, stderr=subprocess.STDOUT).returncode
def tests(tag, core):
    log = f"{OUT}/{tag}.log"; open(log, "w").close(); t = time.time()
    rcs = {}
    if core:
        rcs["build-core"] = sh("nice -n 15 npx tsc --build", f"{W}/packages/core", log)
        rcs["core"] = sh("nice -n 15 npx vitest run src/managed-runtime/managed-session-metadata.test.ts", f"{W}/packages/core", log)
    rcs["cli"] = sh("nice -n 15 npx vitest run src/serve/hosted-harness-session.test.ts src/serve/hosted-harness-contract.test.ts", f"{W}/packages/cli", log)
    text = open(log).read()
    fails = re.findall(r"(?:FAIL|×)\s+([^\n]{0,200})", text)
    return rcs, fails[:5], round(time.time() - t)
only = sys.argv[1:]; res = {}
if not only or "BASE" in only:
    res["BASE"] = tests("TBASE", True); print("BASE", res["BASE"], flush=True)
for mid, desc, f, old, new in MUT:
    if only and mid not in only: continue
    p = f"{W}/{f}"; src = open(p).read(); assert src.count(old) == 1, (mid, src.count(old))
    open(p, "w").write(src.replace(old, new))
    try:
        rcs, fails, secs = tests(mid, f == A)
    finally:
        open(p, "w").write(src)
        if f == A: sh("nice -n 15 npx tsc --build", f"{W}/packages/core", f"{OUT}/{mid}-rebuild.log")
    killed = any(v != 0 for k, v in rcs.items() if k != "build-core")
    verdict = "BUILD-ERROR" if rcs.get("build-core", 0) != 0 else ("KILLED" if killed else "SURVIVED")
    res[mid] = {"desc": desc, "verdict": verdict, "rcs": rcs, "fails": fails, "secs": secs}
    print(mid, verdict, rcs, fails[:2], secs, flush=True)
    json.dump(res, open(f"{OUT}/ts-results3.json", "w"), indent=1)
print("TS-MUT-DONE", flush=True)
