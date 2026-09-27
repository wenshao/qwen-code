#!/bin/bash
# usage: run-unit.sh <label> <machine-id|stock> <mvn args...>
set -u
LABEL=$1; MID=$2; shift 2
rm -rf /work && mkdir -p /work && cp -a /rig/src/. /work/
if [ "$MID" != stock ]; then printf '%s\n' "$MID" > /etc/machine-id; fi
echo "machine-id=[$(cat /etc/machine-id)] boot=$(cat /proc/sys/kernel/random/boot_id) $(readlink /proc/self/ns/pid) $(readlink /proc/self/ns/time) pid1=$(cat /proc/1/comm)"
cd /work/packages/sdk-java/runtime-broker
mvn -o -B -ntp "$@" > /rig/out/$LABEL.log 2>&1; rc=$?
mkdir -p /rig/out/$LABEL-reports && cp -a target/surefire-reports/. /rig/out/$LABEL-reports/ 2>/dev/null
echo "mvn exit=$rc"
grep -E "Tests run:|FAIL|ERROR\]" /rig/out/$LABEL.log | grep -v "^\[INFO\] Tests run: [0-9]*, Failures: 0, Errors: 0" | tail -25
