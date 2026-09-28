#!/bin/bash
# container: same failing tests, PR head vs rebased tree, alternating, same conditions
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/ab-rebased; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
for arm in head rebased; do
  tree=src-v3; [ $arm = rebased ] && tree=src-rebased
  rm -rf /ab-$arm && mkdir -p /ab-$arm && cp -a /rig/$tree/. /ab-$arm/
  cp -a /root/.m2/repository /m2-$arm
  (cd /ab-$arm/packages/sdk-java/qwencode && mvn -B -ntp -q -Dmaven.repo.local=/m2-$arm -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
  (cd /ab-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp -q -Dmaven.repo.local=/m2-$arm -DskipTests -Dcheckstyle.skip=true install >/dev/null 2>&1)
done
for round in 1 2; do
  for arm in head rebased; do
    for cli in v3 main; do
      CLI=/rig/wt-$cli/dist/cli.js
      (cd /ab-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp -Dmaven.repo.local=/m2-$arm test -Pfault-gates -Dqwen.cli.entry=$CLI -Dtest='LocalRebootFaultGateTest,DurableLocalRuntimeFaultGateTest,ProcessCrashFaultGateTest' -Dsurefire.failIfNoSpecifiedTests=false > $O/gates-$arm-$cli-$round.log 2>&1; echo "[round $round] java=$arm worker-bundle=$cli gates: exit=$? $(summary $O/gates-$arm-$cli-$round.log) $(failing $O/gates-$arm-$cli-$round.log | cut -c1-200)")
    done
    (cd /ab-$arm/packages/sdk-java/runtime-broker && mvn -B -ntp -Dmaven.repo.local=/m2-$arm test -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest > $O/jdbc-$arm-$round.log 2>&1; echo "[round $round] java=$arm JdbcRepositoryTest: exit=$? $(summary $O/jdbc-$arm-$round.log) $(failing $O/jdbc-$arm-$round.log)")
  done
done
echo AB-DONE
