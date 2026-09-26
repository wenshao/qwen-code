import subprocess, shutil, sys, os, re, json
SP = sys.argv[1]
label = sys.argv[2]
contract = sys.argv[3] if len(sys.argv) > 3 else None
MOD = f"{SP}/mut/runtime-broker"
BV = f"{MOD}/src/main/java/com/alibaba/qwen/code/runtimebroker/BrokerValues.java"
JC = f"{MOD}/src/test/java/com/alibaba/qwen/code/runtimebroker/JdbcRepositoryContract.java"
orig = open(f"{SP}/BrokerValues.pr.java").read()
shutil.copy(contract or f"{SP}/JdbcRepositoryContract.pr.java", JC)
G = "decimal.scale() > MAXIMUM_DECIMAL_SCALE"
mutants = [
  ("M0 baseline (no change)", None, None),
  ("M1 delete the guard", G, "false"),
  ("M2 '>' becomes '>='", G, "decimal.scale() >= MAXIMUM_DECIMAL_SCALE"),
  ("M3 bound 2048 -> 2049", "MAXIMUM_DECIMAL_SCALE = 2048", "MAXIMUM_DECIMAL_SCALE = 2049"),
  ("M4 bound 2048 -> 2047", "MAXIMUM_DECIMAL_SCALE = 2048", "MAXIMUM_DECIMAL_SCALE = 2047"),
  ("M5 scale() -> precision()", G, "decimal.precision() > MAXIMUM_DECIMAL_SCALE"),
  ("M6 scale() -> stripTrailingZeros().scale()", G, "decimal.stripTrailingZeros().scale() > MAXIMUM_DECIMAL_SCALE"),
  ("A1 two-sided |scale| bound (alternative, not a bug)", G, "Math.abs(decimal.scale()) > MAXIMUM_DECIMAL_SCALE"),
]
env = dict(os.environ, JAVA_HOME="/Users/wenshao/Install/jdk21")
out = []
for name, old, new in mutants:
    src = orig
    if old:
        assert src.count(old) == 1, name
        src = src.replace(old, new)
    open(BV, "w").write(src)
    r = subprocess.run(["/Users/wenshao/Install/maven/bin/mvn", "-B", "-o", "-s", f"{SP}/empty-settings.xml",
        f"-Dmaven.repo.local={SP}/m2repo", "test", "-Djacoco.skip=true", "-Dtest=JdbcRepositoryTest"],
        cwd=MOD, env=env, capture_output=True, text=True)
    log = r.stdout
    m = re.search(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$", log, re.M)
    if "COMPILATION ERROR" in log:
        verdict = "COMPILE_FAIL"
    elif r.returncode == 0:
        verdict = "SURVIVED" if old else "GREEN"
    else:
        verdict = "KILLED"
    why = ""
    fm = re.search(r"(Expected [^\n]{0,90}|JSONException: [^\n]{0,60}|IllegalArgumentException: [^\n]{0,60})", log)
    if fm and verdict == "KILLED":
        why = fm.group(1)
    line = {"set": label, "mutant": name, "verdict": verdict, "why": why}
    print(json.dumps(line)); sys.stdout.flush()
    out.append(line)
open(BV, "w").write(orig)
with open(f"{SP}/mut-results.jsonl", "a") as f:
    for l in out: f.write(json.dumps(l) + "\n")
