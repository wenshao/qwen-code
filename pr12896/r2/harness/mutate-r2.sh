#!/bin/bash
# usage: mutate.sh <mutant> <case1,case2,...> [driver] [probe=false]
# Applies one mutant in wt-mut, rebuilds the affected artifact, runs each case separately, restores.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5b0e58b6-6b84-4099-862a-65878f027ec4/scratchpad
NAME=$1; CASES=$2; DRIVER=${3:-integration-tests/helpers/hosted-process-crash-driver.ts}; PROBE=${4:-false}
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
read KIND MARKER < <(node $SP/rig/mutants.cjs apply $NAME) || exit 2
cd $SP/wt-mut
rebuild() {
  case $KIND in
    ts) rm -rf "${SP:?}/wt-mut/dist"; (node esbuild.config.js && node scripts/copy_bundle_assets.js) > $SP/logs/mut-bundle.log 2>&1 || return 1;;
    broker) mvn --batch-mode -q -Dmaven.repo.local=$SP/m2-mut -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SP/logs/mut-broker.log 2>&1 || return 1;;
  esac
}
rebuild || { echo "$NAME build failed"; node $SP/rig/mutants.cjs restore $NAME; exit 3; }
case $KIND in
  ts) N=$(grep -rl "$MARKER" dist | wc -l);;
  broker) N=$(unzip -p $SP/m2-mut/com/alibaba/qwen-managed-runtime-broker/0.1.0-alpha/qwen-managed-runtime-broker-0.1.0-alpha.jar | grep -a -c "$MARKER");;
  server) N=1;;
esac
echo "mutant $NAME kind=$KIND marker-hits=$N"
[ "$N" -gt 0 ] || { echo "marker missing"; exit 4; }
for C in ${CASES//,/ }; do
  LABEL=mut-$NAME-$C
  M2=$SP/m2-mut WT=wt-mut $SP/rig/it2.sh $LABEL mysql hosted-process-crashes verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
    -Dqwen.fg6c.case=$C -Dqwen.fg6c.driver=$DRIVER -Dqwen.fg6c.probe=$PROBE > /dev/null 2>&1
  RC=$?
  L=$SP/logs/it-$LABEL.log
  [ $KIND = server ] && grep -c "$MARKER" $SP/wt-mut/packages/sdk-java/managed-agent-server/target/classes/com/alibaba/qwen/code/managedagent/service/WorkspaceRuntimeTransport.class > /dev/null && SM=compiled || SM=
  WHY=$(node $SP/rig/why.cjs $L)
  echo "$NAME $C exit=$RC ok=$(grep -c '^HOSTED_PROCESS_CRASH_OK' $L) $SM | $WHY" | tee -a $SP/results/mutants-r2.txt
done
node $SP/rig/mutants.cjs restore $NAME > /dev/null
case $KIND in
  ts) rm -rf "${SP:?}/wt-mut/dist"; cp -Rc $SP/rig/dist.r2 $SP/wt-mut/dist;;
  broker) rebuild;;
esac
echo "restored $NAME"
