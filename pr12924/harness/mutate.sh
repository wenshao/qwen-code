#!/bin/bash
# usage: mutate.sh <mutant> <case1,case2,...>
# Applies one mutant in wt-mut, rebuilds the affected artifact(s), runs each FG6d case separately, restores.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/028f1664-c9a6-47d4-91b9-cc5a71282104/scratchpad
NAME=$1; CASES=$2
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
read KIND MARKERS < <(node $SP/rig/mutants.cjs apply "$NAME") || exit 2
cd $SP/wt-mut
BROKER_JAR=$(ls $SP/m2-mut/com/alibaba/qwen-managed-runtime-broker/*/qwen-managed-runtime-broker-*.jar | grep -v -e sources -e tests | head -1)
rebuild() {
  if [[ $KIND == *ts* ]]; then rm -rf "${SP:?}/wt-mut/dist"; (node esbuild.config.js && node scripts/copy_bundle_assets.js) > $SP/logs/mut-bundle.log 2>&1 || return 1; fi
  if [[ $KIND == *broker* ]]; then mvn --batch-mode -q -Dmaven.repo.local=$SP/m2-mut -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SP/logs/mut-broker.log 2>&1 || return 1; fi
}
rebuild || { echo "$NAME build failed"; node $SP/rig/mutants.cjs restore "$NAME"; exit 3; }
for MK in ${MARKERS//,/ }; do
  case $MK in
    *_J*) N=$(unzip -p $BROKER_JAR | grep -a -c "$MK");;
    *) N=$(grep -rl "$MK" dist | wc -l | tr -d ' ');;
  esac
  echo "mutant $NAME kind=$KIND marker=$MK hits=$N"
  [ "$N" -gt 0 ] || { echo "marker missing"; node $SP/rig/mutants.cjs restore "$NAME"; exit 4; }
done
for C in ${CASES//,/ }; do
  LABEL=mut-$NAME-$C
  M2=m2-mut WT=wt-mut $SP/rig/it.sh $LABEL mysql hosted-workspace-tools verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
    -Dit.test='HostedWorkspaceToolTurnIT#cancellationRequiresPhysicalSettlementOnMySql' -Dqwen.fg6d.case=$C > /dev/null 2>&1
  RC=$?
  L=$SP/logs/it-$LABEL.log
  WHY=$(node $SP/rig/why.cjs $L)
  echo "$NAME $C exit=$RC ok=$(grep -c '^HOSTED_CANCELLATION_OK' $L) | $WHY" | tee -a $SP/results/mutants.txt
done
node $SP/rig/mutants.cjs restore "$NAME" > /dev/null
if [[ $KIND == *ts* ]]; then rm -rf "${SP:?}/wt-mut/dist"; cp -Rc $SP/rig/dist.pr $SP/wt-mut/dist; fi
if [[ $KIND == *broker* ]]; then mvn --batch-mode -q -Dmaven.repo.local=$SP/m2-mut -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SP/logs/mut-broker.log 2>&1; fi
echo "restored $NAME"
