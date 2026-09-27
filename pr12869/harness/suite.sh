#!/bin/bash
# usage: suite.sh <label> <module> <mvn args...>   (runs inside the Linux container)
set -u
LABEL=$1; MODULE=$2; shift 2
W=/work-$LABEL
rm -rf $W && mkdir -p $W && cp -a /rig/src/. $W/
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
echo "machine-id=[$(cat /etc/machine-id)] boot=$(cat /proc/sys/kernel/random/boot_id) $(readlink /proc/self/ns/pid) pid1=$(cat /proc/1/comm) kernel=$(uname -r) java=$(java -version 2>&1 | head -1) node=$(node -v)"
cd $W/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install > /rig/out/$LABEL.pre.log 2>&1
cd ../runtime-broker && mvn -B -ntp -q -DskipTests install >> /rig/out/$LABEL.pre.log 2>&1
cd $W/packages/sdk-java/$MODULE
START=$(date +%s)
mvn -B -ntp "$@" > /rig/out/$LABEL.log 2>&1; rc=$?
END=$(date +%s)
rm -rf /rig/out/$LABEL-reports; mkdir -p /rig/out/$LABEL-reports
cp -a target/surefire-reports/. /rig/out/$LABEL-reports/ 2>/dev/null
cp -a target/failsafe-reports/. /rig/out/$LABEL-reports/ 2>/dev/null
echo "mvn exit=$rc seconds=$((END-START))"
grep -E "Tests run:.*(Failures|Errors)" /rig/out/$LABEL.log | tail -3
grep -E "^\[ERROR\]" /rig/out/$LABEL.log | head -30
