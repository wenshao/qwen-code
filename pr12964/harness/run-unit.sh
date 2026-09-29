#!/bin/bash
# inside container: run-unit.sh <tree> <label> <module> <mvn args...>
TREE=$1; LABEL=$2; MOD=$3; shift 3
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
rm -rf /work && mkdir -p /work && cp -a /rig/$TREE/. /work/ && cp -a /rig/dist /work/dist
cd /work/packages/sdk-java/qwencode && mvn -o -B -ntp -q -DskipTests -Dgpg.skip=true install > /dev/null 2>&1
cd /work/packages/sdk-java/runtime-broker && mvn -o -B -ntp -q -DskipTests install > /dev/null 2>&1
cd /work/packages/sdk-java/$MOD
mvn -o -B -ntp "$@" > /rig/out/$LABEL.log 2>&1; rc=$?
echo "$LABEL exit=$rc $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' /rig/out/$LABEL.log | tail -1)"
grep -E "^\[ERROR\]   [A-Za-z]" /rig/out/$LABEL.log | head -8
