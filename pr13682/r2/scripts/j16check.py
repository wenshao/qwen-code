# VERIFICATION RIG ONLY (PR #13682 R2): is the full-suite red under J16 (ReplayFloorRetractionTest) caused by J16?
# Run that test class alone 3x unmutated and 3x with J16 applied; restore byte-for-byte.
import subprocess, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mutants import MUTANTS
W = "/root/v13682/mut3"; D = f"{W}/packages/sdk-java/managed-agent-server"
ENV = dict(os.environ, JAVA_HOME="/opt/jdk21", PATH="/opt/jdk21/bin:/root/v13163/tools/apache-maven-3.9.9/bin:" + os.environ["PATH"], TZ="UTC")
CMD = ("mvn -B -ntp -Dmaven.repo.local=/root/v13682/m2-h3 -Dmaven.repo.local.tail=/root/.m2/repository"
       " -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=ReplayFloorRetractionTest -Dsurefire.failIfNoSpecifiedTests=false test")
def run(tag):
    out = subprocess.run(CMD, shell=True, cwd=D, env=ENV, capture_output=True, text=True).stdout
    t = re.findall(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+)", out)
    return tag, t[-1] if t else None
m = [x for x in MUTANTS if x[0] == "J16"][0]
p = f"{W}/{m[2]}"; src = open(p).read(); assert src.count(m[3]) == 1
for i in range(3):
    print(run(f"base{i}"), flush=True)
open(p, "w").write(src.replace(m[3], m[4]))
try:
    for i in range(3):
        print(run(f"J16-{i}"), flush=True)
finally:
    open(p, "w").write(src)
assert open(p).read() == src
print("restored")
