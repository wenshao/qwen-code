#!/bin/bash
# Re-run the one failed fault gate at head, isolated, N times.
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/r3; mkdir -p $O
rm -rf /w-gate && mkdir -p /w-gate && cp -a /rig/src-v4/. /w-gate/
(cd /w-gate/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
(cd /w-gate/packages/sdk-java/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $O/gate-repro-build.log 2>&1)
for i in 1 2 3 4 5; do
  (cd /w-gate/packages/sdk-java/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=/rig/wt-v4/dist/cli.js -Dtest='ProcessCrashFaultGateTest#aLostJournalEndsPollingWithoutReleasingTheWriterDomain' -Dsurefire.failIfNoSpecifiedTests=false > $O/gate-repro-$i.log 2>&1)
  echo "run $i: exit=$? $(grep -E 'Tests run:.*-- in ' $O/gate-repro-$i.log | sed 's/^\[[A-Z]*\] //')"
done
echo GATE-REPRO-DONE
