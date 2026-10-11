#!/bin/bash
# usage: run.sh <arm-label>   runs the round-5 probes (O, B, S, K3) on H2 and MySQL 8.4.7 in the worktree W (default: the fe0ae13e worktree)
P=$(cd $(dirname $0); pwd); R=$P/../../rig; W=${W:-$HOME/git/qwen-code-pr13654-merge}; ARM=${1:-fe0ae13e}
cd $W || exit 1; echo "worktree at $(git rev-parse --short HEAD)"
$P/install.sh $W || exit 1
OUT=$P/probe-$ARM.txt; rm -f $OUT
$R/${MVN:-mvn-merge.sh} -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration \
  -Dtest="RigR5ProbeTest#${PROBES:-probeO*+probeB_*+probeS_*+probeK3*}" -Dit.test="RigR5ProbeMySqlIT#${PROBES:-probeO*+probeB_*+probeS_*+probeK3*}" \
  -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13654/p654probe5?allowPublicKeyRetrieval=true&useSSL=false&createDatabaseIfNotExist=true" -Dmysql.user=root -Dmysql.password=rig13654 \
  -Dprobe.out=$OUT -Dprobe.arm=$ARM -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true \
  verify > $P/mvn-$ARM.log 2>&1
echo "mvn exit=$?"
D=packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store
rm -f $D/RigR5ProbeTest.java $D/RigR5ProbeMySqlIT.java; git status --porcelain | head -3; echo "probe sources removed"
cd packages/sdk-java/managed-agent-server; rm -rf $P/reports-$ARM; mkdir -p $P/reports-$ARM; cp target/surefire-reports/TEST-*RigR5*.xml target/failsafe-reports/TEST-*RigR5*.xml $P/reports-$ARM/ 2>/dev/null
python3 $P/summ.py $P/reports-$ARM
echo "== probes"; sort $OUT
