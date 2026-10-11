#!/bin/bash
# usage: run.sh <arm: head|cand3|f4ee|99ff|r3>
#   head  : 569befb8 as pushed
#   cand3 : head + candidate-settled-accepted-work.diff (round-3 candidate)
#   f4ee / 99ff / r3 : the two store files (ToolPublicationStore, ToolPublicationDataStore) taken from
#          f4eee7cb39 / 99ff615254 / 50312cfb (round-3 head); everything else (tests, main code) stays at head
P=$(cd $(dirname $0); pwd); R=$P/../../rig; W=$HOME/git/qwen-code-pr13654-probe; ARM=$1
F=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java
D=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java
cd $W || exit 1
[ "$(git rev-parse HEAD)" = 569befb8de3cc7d58d0d26a5312b582242e174b9 ] || { echo "probe worktree not at head"; exit 1; }
git checkout -q -- $F $D
case $ARM in
  head) ;;
  cand3) git apply $P/candidate-settled-accepted-work.diff || exit 1;;
  f4ee) C=f4eee7cb39d7258d7acb3bf91cfc495aa8a98e7a;;
  99ff) C=99ff615254ad97868129ffdd108f27efdb712cf8;;
  r3) C=50312cfbbdf0d81ff1420f330cf7e5fef021aac5;;
  *) echo "unknown arm"; exit 1;;
esac
if [ -n "$C" ]; then git show $C:$F > $F && git show $C:$D > $D || exit 1; fi
echo "arm=$ARM diff vs head:"; git diff --stat -- $F $D
OUT=$P/probe-$ARM.txt; rm -f $OUT
$R/mvn-r2.sh -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration \
  -Dtest='RigR4ProbeTest#probe*,ToolPublicationAsyncVerificationTest' \
  -Dit.test="RigR4ProbeMySqlIT#probe*${ITS:-}" \
  -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13654/p654probe4?allowPublicKeyRetrieval=true&useSSL=false&createDatabaseIfNotExist=true" -Dmysql.user=root -Dmysql.password=rig13654 \
  -Dprobe.out=$OUT -Dprobe.arm=$ARM -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true \
  clean verify > $P/mvn-$ARM.log 2>&1
echo "mvn exit=$?"
git checkout -q -- $F $D; git diff --quiet -- $F $D && echo "restored $(git hash-object $F) $(git hash-object $D)"
cd packages/sdk-java/managed-agent-server; rm -rf $P/reports-$ARM; mkdir -p $P/reports-$ARM; cp target/surefire-reports/TEST-*.xml target/failsafe-reports/TEST-*.xml $P/reports-$ARM/ 2>/dev/null
python3 $P/summ.py $P/reports-$ARM
echo "== probes"; cat $OUT
