#!/bin/bash
# inside container: run-loop.sh <tree> <label> <n> <test>
TREE=$1; LABEL=$2; N=$3; TEST=$4
rm -rf /work && mkdir -p /work && cp -a /rig/$TREE/. /work/
cd /work/packages/sdk-java/runtime-broker && mvn -o -B -ntp -q test-compile > /dev/null 2>&1
pass=0; fail=0
for i in $(seq 1 $N); do
  mvn -o -B -ntp surefire:test -Dtest="$TEST" > /tmp/r.log 2>&1 && pass=$((pass+1)) || { fail=$((fail+1)); grep -E "^\[ERROR\]   [A-Za-z]" /tmp/r.log | head -2; }
done
echo "$LABEL: $pass passed, $fail failed of $N"
