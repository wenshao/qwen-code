#!/bin/bash
# usage: W=<worktree> MVN=<mvn wrapper> run.sh <arm-label> [h2|both]   runs the round-6 probes and removes the probe sources afterwards
P=$(cd $(dirname $0); pwd); R=$P/../../rig; W=${W:-$HOME/git/qwen-code-pr13654}; ARM=${1:?arm}; DBS=${2:-both}
cd $W || exit 1; echo "worktree $W at $(git rev-parse --short HEAD) $(date +%T)"
$P/install.sh $W || exit 1
OUT=$P/probe-$ARM.txt; rm -f $OUT
SEL="${PROBES:-probeO*+probeOT*+probeC_*+probeU*+probeB_*+probeS_*+probeK3*}"
IT=""; [ "$DBS" = both ] && IT="-Pmysql-integration -Dit.test=RigR6ProbeMySqlIT#$SEL"
$R/${MVN:-mvn.sh} -f packages/sdk-java/managed-agent-server/pom.xml \
  -Dtest="RigR6ProbeTest#$SEL" $IT \
  -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13654/p654probe6?allowPublicKeyRetrieval=true&useSSL=false&createDatabaseIfNotExist=true" -Dmysql.user=root -Dmysql.password=rig13654 \
  -Dprobe.out=$OUT -Dprobe.arm=$ARM -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true \
  verify > $P/mvn-$ARM.log 2>&1
echo "mvn exit=$? $(date +%T)"
D=packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store
rm -f $D/RigR6ProbeTest.java $D/RigR6ProbeMySqlIT.java; echo "probe sources removed; dirty files: $(git status --porcelain | wc -l | tr -d ' ')"
cd packages/sdk-java/managed-agent-server; rm -rf $P/reports-$ARM; mkdir -p $P/reports-$ARM; cp target/surefire-reports/TEST-*RigR6*.xml target/failsafe-reports/TEST-*RigR6*.xml $P/reports-$ARM/ 2>/dev/null
python3 $P/summ.py $P/reports-$ARM
grep -E 'COMPILATION ERROR|ERROR\].*\.java' $P/mvn-$ARM.log | head -10
echo "== probes"; sort $OUT 2>/dev/null
