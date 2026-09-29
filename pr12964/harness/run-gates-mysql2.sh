#!/bin/bash
# same as run-gates-mysql.sh but passes extra -D args via EXTRA env
TREE=$1; LABEL=$2; N=$3; TEST=$4
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
rm -rf /work && mkdir -p /work && cp -a /rig/$TREE/. /work/ && cp -a /rig/dist /work/dist
cd /work/packages/sdk-java/runtime-broker
mvn -B -ntp -q -Pmysql-integration test-compile > /rig/out/$LABEL-compile.log 2>&1 || { echo "compile failed"; tail -20 /rig/out/$LABEL-compile.log; exit 1; }
for i in $(seq 1 $N); do
  mvn -o -B -ntp surefire:test -Pfault-gates,mysql-integration -Dgate.mysql.port=3306 -Dqwen.cli.entry=/work/dist/cli.js $EXTRA -Dtest="$TEST" -Dsurefire.failIfNoSpecifiedTests=false > /tmp/r.log 2>&1
  echo "$LABEL run $i: $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' /tmp/r.log | tail -1)"
  grep -E "^\[ERROR\]   [A-Za-z]|Tests run:.*FAIL" /tmp/r.log | head -8
  cp /tmp/r.log /rig/out/$LABEL-$i.log
  mkdir -p /rig/out/$LABEL-$i-reports && cp -a target/surefire-reports/. /rig/out/$LABEL-$i-reports/ 2>/dev/null
done
