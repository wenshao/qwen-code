#!/bin/bash
# container: RebootRecoveryGapTest dropped into the head tree, against the unmutated tree and the mutants it is meant to pin.
# usage: gap-run.sh  (env TREE, default src-v4)
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
TREE=${TREE:-src-v4}; O=/rig/out/gap4; mkdir -p $O
W=/w-gap; rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
SJ=$W/packages/sdk-java
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
cp /rig/cand/RebootRecoveryGapTest.java $SJ/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.runtimebroker\.//; s/RebootRecoveryGapTest\.//' | sort -u | tr '\n' ';'; }
for id in BASE M01 M16; do
  if [ $id != BASE ]; then
    file=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').file))")
    node /rig/mut/apply.mjs $W $id > $O/$id.apply.log 2>&1
    cmp -s /rig/$TREE/$file $W/$file && { echo "[$id] NOT APPLIED"; continue; }
  fi
  (cd $SJ/runtime-broker && mvn -B -ntp $R test -Dtest=RebootRecoveryGapTest -Dcheckstyle.skip=true > $O/$id.log 2>&1); rc=$?
  echo "[$id] exit=$rc $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $O/$id.log | tail -1) $(failing $O/$id.log)"
  [ $id != BASE ] && cp /rig/$TREE/$file $W/$file
done
(cd $SJ/runtime-broker && mvn -B -ntp $R checkstyle:check > $O/checkstyle.log 2>&1); echo "[checkstyle with the test in the tree] exit=$? $(grep -c -E '^\[(WARN|ERROR)\].*\.java' $O/checkstyle.log) warning/error lines"
echo GAP-DONE
