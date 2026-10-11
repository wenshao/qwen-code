#!/bin/bash
# usage: mut.sh <id> [full]   focused classes by default; "full" = whole managed-agent-server suite
id=$1; mode=${2:-focused}; R=/root/pr13330-r4; D=$R/mut/$id; L=$R/logs/mut-$id-$mode.log
rm -rf $D; mkdir -p $D $R/m2/mut-$id
cp -a $R/trees/head/packages $D/
find $D -name target -type d -prune -exec rm -rf {} +
python3 $R/probe/mutants_r4.py $D $id > $L 2>&1 || { echo EXIT=apply-failed >> $L; exit; }
FOCUS="EmbeddedRuntimeBrokerTest,QwenHostedHarnessConnectorTest,HarnessEventProjectorTest,EventIdentityTest,HarnessCoordinatorTest,ManagedSessionLifecycleTest,MessageMaterializerTest,ManagedMaterializationDeferTest"
run() { # module, args...
  local mod=$1; shift
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
  export PATH=$JAVA_HOME/bin:$PATH
  (cd $D/packages/sdk-java/$mod && mvn --batch-mode --no-transfer-progress -s /root/.m2/settings.xml \
    -Dmaven.repo.local=$R/m2/mut-$id -Dmaven.repo.local.tail=$R/m2/head,/root/.m2/repository \
    -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true -Dgpg.skip=true "$@")
}
case $id in
  a05|a06|a09)
    echo "== runtime-broker RuntimeBrokerServiceTest + install" >> $L
    run runtime-broker -Dtest=RuntimeBrokerServiceTest -Dsurefire.failIfNoSpecifiedTests=false install >> $L 2>&1
    echo "RB_EXIT=$?" >> $L
    run runtime-broker -DskipTests install >> $L 2>&1 ;;
esac
echo "== managed-agent-server ($mode)" >> $L
if [ "$mode" = full ]; then
  run managed-agent-server -DargLine=-Xmx4g -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=$R/cli/dist/cli.js test >> $L 2>&1
else
  run managed-agent-server -Dtest=$FOCUS -Dsurefire.failIfNoSpecifiedTests=false test >> $L 2>&1
fi
echo EXIT=$? >> $L
rm -rf $D $R/m2/mut-$id
