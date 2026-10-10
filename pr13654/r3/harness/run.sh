#!/bin/bash
# usage: run.sh <arm: head|revert> ; runs H2 + real MySQL 8.4 probes and the PR's own async suite in the probe worktree
P=$(cd $(dirname $0); pwd); R=$P/../../rig; W=$HOME/git/qwen-code-pr13654-probe; ARM=$1
F=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java
cd $W || exit 1
D=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java
git checkout -q -- $F $D
if [ "$ARM" = cand3 ]; then git apply $P/candidate-settled-accepted-work.diff || exit 1; fi
if [ "$ARM" = revert ]; then
  n=$(grep -c '^                Access.CLAIM, true);$' $F); [ "$n" = 1 ] || { echo "anchor count $n"; exit 1; }
  sed -i '' 's/^                Access.CLAIM, true);$/                Access.PRODUCE, true);/' $F
fi
echo "arm=$ARM diff:"; git diff --stat -- $F $D; git diff -U0 -- $F $D | grep '^[-+] ' 
OUT=$P/probe-$ARM.txt; rm -f $OUT
$R/mvn-r2.sh -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration \
  -Dtest='RigCsiRetirementProbeTest#probe*,ToolPublicationAsyncVerificationTest' \
  -Dit.test="RigCsiRetirementProbeMySqlIT#probe*${ITS:-}" \
  -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13654/p654probe?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13654 \
  -Dprobe.out=$OUT -Dprobe.arm=$ARM -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true \
  clean verify > $P/mvn-$ARM.log 2>&1
echo "mvn exit=$?"
git checkout -q -- $F $D; git diff --quiet -- $F $D && echo "restored $(git hash-object $F) $(git hash-object $D)"
cd packages/sdk-java/managed-agent-server; rm -rf $P/reports-$ARM; mkdir -p $P/reports-$ARM; cp target/surefire-reports/TEST-*.xml target/failsafe-reports/TEST-*.xml $P/reports-$ARM/ 2>/dev/null
python3 $P/summ.py $P/reports-$ARM
echo "== probes"; cat $OUT
