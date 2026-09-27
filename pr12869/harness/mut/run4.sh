#!/bin/bash
# the two gap tests: pass at the head, fail under the mutants they are meant to catch
set -u
T=packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker
W=/w4; rm -rf $W && mkdir -p $W && cp -a /rig/src-v2/. $W/
cp /rig/cand/RebootRecoveryGapTest.java $W/$T/
(cd $W/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
for id in BASE M01 M16; do
  if [ $id != BASE ]; then
    file=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').file))")
    node /rig/mut/apply.mjs $W $id >/dev/null
  fi
  (cd $W/packages/sdk-java/runtime-broker && mvn -B -ntp test -Dtest=RebootRecoveryGapTest > /rig/out/gap-$id.log 2>&1); rc=$?
  echo "[$id] exit=$rc $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' /rig/out/gap-$id.log | tail -1) $(grep -E '<<< (FAILURE|ERROR)!' /rig/out/gap-$id.log | grep -v ' in com' | sed -E 's/ -- Time.*//; s/.*RebootRecoveryGapTest\.//' | tr '\n' ';')"
  [ $id != BASE ] && cp /rig/src-v2/$file $W/$file
done
(cd $W/packages/sdk-java/runtime-broker && mvn -B -ntp checkstyle:check > /rig/out/gap-checkstyle.log 2>&1; echo "[checkstyle with the new tests] exit=$? $(grep -c 'WARN\|ERROR' /rig/out/gap-checkstyle.log) warning/error lines")
