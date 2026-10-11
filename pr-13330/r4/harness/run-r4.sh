#!/bin/bash
# PR13330 R4 — full probe orchestration on the cloud box. Sequential: probes count
# live worker processes globally, so nothing else may spawn CLI workers meanwhile.
R=/root/pr13330-r4
set -x
# 1. place probe classes into both arms
for arm in base head; do
  cp $R/probe/Pr13330R3FenceProbe.java $R/probe/Pr13330R3OperabilityProbe.java $R/probe/Pr13330ToolItemIdentityProbe.java \
    $R/trees/$arm/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/ || exit 1
done
# 2. test-compile both arms (probes included)
for arm in head base; do
  $R/mvn.sh $arm managed-agent-server 3 8g -DskipTests test-compile > $R/logs/compile-$arm.log 2>&1 \
    || { echo COMPILE_FAIL_$arm; tail -30 $R/logs/compile-$arm.log; exit 1; }
  echo "compile $arm OK"
done
# 3. fence probe (30 admission cells + 5 release cells per arm)
$R/probe.sh base Pr13330R3FenceProbe fence-base
$R/probe.sh head Pr13330R3FenceProbe fence-head
# 4. tool identity: base records the legacy stored tool_call, head reads it
$R/mvn.sh base managed-agent-server 3 8g -Dsurefire.failIfNoSpecifiedTests=false \
  -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=$R/cli/dist/cli.js \
  -Dprobe.recordLegacy=true -Dprobe.legacy=$R/data/legacy-tool-call.json \
  -Dtest=Pr13330ToolItemIdentityProbe test > $R/logs/ident-base.log 2>&1
echo EXIT=$? >> $R/logs/ident-base.log
$R/mvn.sh head managed-agent-server 3 8g -Dsurefire.failIfNoSpecifiedTests=false \
  -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=$R/cli/dist/cli.js \
  -Dprobe.legacy=$R/data/legacy-tool-call.json \
  -Dtest=Pr13330ToolItemIdentityProbe test > $R/logs/ident-head.log 2>&1
echo EXIT=$? >> $R/logs/ident-head.log
# 5. startup guards + rename + k8s wording
$R/probe.sh base 'Pr13330R3OperabilityProbe#startupValidation' startup-base
$R/probe.sh head 'Pr13330R3OperabilityProbe#startupValidation' startup-head
# 6. materializer backoff / starvation / saturation / scheduler stall
$R/probe.sh base 'Pr13330R3OperabilityProbe#poisonedMaterializationTargets+materializerStallVersusDefaultScheduler' oper-base
$R/probe.sh head 'Pr13330R3OperabilityProbe#poisonedMaterializationTargets+materializerStallVersusDefaultScheduler' oper-head
echo PROBES_DONE
