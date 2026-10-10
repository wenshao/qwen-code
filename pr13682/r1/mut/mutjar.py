# VERIFICATION RIG ONLY (PR #13682): build server jars carrying single mutants (J11, J14) from the h worktree, restoring sources.
import subprocess, sys, os, shutil
sys.path.insert(0, "/root/v13682/mutpy")
from mutants import MUTANTS
V = "/root/v13682"; W = f"{V}/h"
ENV = dict(os.environ, JAVA_HOME="/opt/jdk21", PATH="/opt/jdk21/bin:/root/v13163/tools/apache-maven-3.9.9/bin:" + os.environ["PATH"])
for mid in sys.argv[1:]:
    m = [x for x in MUTANTS if x[0] == mid][0]
    p = f"{W}/{m[2]}"; src = open(p).read(); assert src.count(m[3]) == 1
    open(p, "w").write(src.replace(m[3], m[4]))
    try:
        rc = subprocess.run(f"nice -n 10 mvn -B -ntp -q -Dmaven.repo.local={V}/m2-h -Dmaven.repo.local.tail=/root/.m2/repository -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package > {V}/out/build-h{mid}.log 2>&1", shell=True, cwd=f"{W}/packages/sdk-java/managed-agent-server", env=ENV).returncode
    finally:
        open(p, "w").write(src)
    shutil.copy(f"{W}/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar", f"{V}/server/h{mid}-server.jar")
    if os.path.lexists(f"{V}/rig/server/h{mid}-server.jar"): os.remove(f"{V}/rig/server/h{mid}-server.jar")
    os.symlink(f"{V}/server/h{mid}-server.jar", f"{V}/rig/server/h{mid}-server.jar")
    print(mid, "rc", rc, flush=True)
print(subprocess.run(["git", "-C", W, "status", "--short"], capture_output=True, text=True).stdout or "h worktree clean")
