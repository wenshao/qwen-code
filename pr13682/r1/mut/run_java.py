# VERIFICATION RIG ONLY (PR #13682): apply one Java mutant at a time to the mutation worktree, run the focused
# suites, restore the file byte-for-byte, and record killed/survived with the first failing test.
import subprocess, sys, os, re, json, time
sys.path.insert(0, os.path.dirname(__file__))
from mutants import MUTANTS
W = "/root/v13682/mut"
OUT = "/root/v13682/out/mut"; os.makedirs(OUT, exist_ok=True)
M2 = "-Dmaven.repo.local=/root/v13682/m2-h -Dmaven.repo.local.tail=/root/.m2/repository"
ENV = dict(os.environ, JAVA_HOME="/opt/jdk21", PATH="/opt/jdk21/bin:/root/v13163/tools/apache-maven-3.9.9/bin:" + os.environ["PATH"], TZ="UTC")
TESTS = {
  "managed-agent-server": "ManagedActionsTest,ManagedAgentServerIntegrationTest,ManagedArtifactApiIntegrationTest,ManagedSessionLifecycleTest,ManagedWorkspaceAdmissionTest,QwenHostedHarnessConnectorTest,ActionResponseCoordinatorTest,WorkspaceMigrationStoreTest",
  "qwencode": "HostedHarnessClientTest",
}
def run(mod, tag):
    d = f"{W}/packages/sdk-java/{mod}"
    log = f"{OUT}/{tag}{'-full' if os.environ.get('FULL') == '1' else ''}.log"
    sel = "" if os.environ.get("FULL") == "1" else f"-Dtest={TESTS[mod]} -Dsurefire.failIfNoSpecifiedTests=false"
    cmd = f"nice -n 15 mvn -B -ntp {M2} -Dcheckstyle.skip=true -Dspotbugs.skip=true {sel} test"
    t = time.time()
    with open(log, "w") as fh:
        rc = subprocess.run(cmd, shell=True, cwd=d, env=ENV, stdout=fh, stderr=subprocess.STDOUT).returncode
    text = open(log).read()
    tests = re.findall(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n", text)
    total = tests[-1] if tests else None
    fails = re.findall(r"\[ERROR\]   ([\w.]+[:.]\w+[^\n]{0,160})", text)
    comp = "COMPILATION ERROR" in text
    return rc, total, fails[:4], comp, round(time.time() - t)
only = sys.argv[1:]
res = {}
if not only or "BASE" in only:
    for mod in TESTS:
        res[f"BASE-{mod}"] = run(mod, f"BASE-{mod}")
        print("BASE", mod, res[f"BASE-{mod}"], flush=True)
for mid, desc, f, old, new, mod in MUTANTS:
    if only and mid not in only: continue
    p = f"{W}/{f}"; src = open(p).read()
    assert src.count(old) == 1, (mid, src.count(old))
    open(p, "w").write(src.replace(old, new))
    try:
        rc, total, fails, comp, secs = run(mod, mid)
    finally:
        open(p, "w").write(src)
    assert open(p).read() == src
    verdict = "COMPILE-ERROR" if comp else ("KILLED" if rc != 0 else "SURVIVED")
    res[mid] = {"desc": desc, "verdict": verdict, "total": total, "fails": fails, "secs": secs}
    print(mid, verdict, total, fails[:2], secs, flush=True)
    json.dump(res, open(f"{OUT}/java-results-{'-'.join(only) or 'all'}{'-full' if os.environ.get('FULL') == '1' else ''}.json", "w"), indent=1)
print("JAVA-MUT-DONE", flush=True)
