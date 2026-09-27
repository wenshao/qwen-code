#!/bin/bash
# usage: run-probe.sh <label> <machine-id> <-Dtest=...>
set -u
LABEL=$1; MID=$2; shift 2
rm -rf /work && mkdir -p /work && cp -a /rig/src/. /work/
printf '%s\n' "$MID" > /etc/machine-id
cp /rig/probe/PR12865ProbeTest.java /work/packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
echo "pid1=$(cat /proc/1/comm)"
export PROBE_OUT=/rig/out/$LABEL.probe.log; rm -f $PROBE_OUT
if [ "${CAND:-0}" = 1 ]; then S=/work/packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker; cp /rig/cand/LocalRuntimeStore.java /rig/cand/LocalProcessRuntimeProvisioner.java $S/; echo "candidate A+B applied"; fi
cd /work/packages/sdk-java/runtime-broker
mvn -o -B -ntp test -Pfault-gates -Dsurefire.failIfNoSpecifiedTests=false "$@" > /rig/out/$LABEL.log 2>&1; rc=$?
echo "mvn exit=$rc"; grep -E "Tests run:" /rig/out/$LABEL.log | tail -2
