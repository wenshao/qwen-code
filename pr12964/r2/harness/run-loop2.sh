#!/bin/bash
# inside container: run-loop2.sh <tree> <label> <n> <test> ; keeps per-run failure lines with the parameter index
TREE=$1; LABEL=$2; N=$3; TEST=$4
rm -rf /work && mkdir -p /work && cp -a /rig/$TREE/packages/sdk-java/runtime-broker /work/ 
cd /work/runtime-broker && mvn -o -B -ntp -q test-compile > /dev/null 2>&1 || { echo compile failed; exit 1; }
pass=0; fail=0; : > /rig/out/$LABEL-failures.txt
for i in $(seq 1 $N); do
  if mvn -o -B -ntp surefire:test -Dtest="$TEST" > /tmp/r.log 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); grep -h -E "<<< FAILURE|expected:" target/surefire-reports/*.txt | sed "s/^/run $i: /" >> /rig/out/$LABEL-failures.txt; fi
done
echo "$LABEL: $pass passed, $fail failed of $N"
