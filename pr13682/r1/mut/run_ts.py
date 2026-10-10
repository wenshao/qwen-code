# VERIFICATION RIG ONLY (PR #13682): TS mutants. Core mutants rebuild core (the CLI tests import core's dist) and run
# the core metadata test plus the CLI hosted-harness test; CLI mutants run the CLI test only. Files restored byte-for-byte.
import subprocess, sys, os, re, json, time
W = "/root/v13682/mut"; OUT = "/root/v13682/out/mut"; os.makedirs(OUT, exist_ok=True)
A = "packages/core/src/managed-runtime/managed-session-authority.ts"
H = "packages/cli/src/serve/hosted-harness-session.ts"
MUT = [
 ("T1", "fence lets an equal revision overwrite", A, "BigInt(requestedRevision) <= BigInt(savedRevision))", "BigInt(requestedRevision) < BigInt(savedRevision))"),
 ("T2", "fence removed (older revision overwrites)", A, "            throw new ManagedSessionTitleSupersededError();\n", "            void 0;\n"),
 ("T3", "unversioned writer drops the watermark", A, "            managedRenameRevision: requestedRevision ?? savedRevision,", "            managedRenameRevision: requestedRevision,"),
 ("T4", "per-attempt command identity broken (lost-reply replay writes again)", H, "              commandId: `hosted-title:${revision}`,", "              commandId: `hosted-title:${revision}:${Date.now()}:${Math.random()}`,"),
 ("T5", "superseded answered 503 instead of 409", H, "            failure instanceof ManagedSessionConflictError\n            ? 409\n            : 503,", "            failure instanceof ManagedSessionConflictError\n            ? 503\n            : 503,"),
 ("T6", "route stops echoing the revision", H, "            : { managedRenameRevision: revision }),", "            : {}),"),
 ("T7", "route ignores the revision (always unfenced sink write)", H, "      revision === undefined\n        ? session.managed.sink.write(", "      true\n        ? session.managed.sink.write("),
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
    json.dump(res, open(f"{OUT}/ts-results.json", "w"), indent=1)
print("TS-MUT-DONE", flush=True)
