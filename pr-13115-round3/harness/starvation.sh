#!/bin/bash
cd /root/verify/pr13115/r3/starve/arm/runtime-broker
OUT=/root/verify/pr13115/r3/starve; : > $OUT/results.tsv
H=(); for h in 1 2 3 4; do taskset -c 10-11 yes > /dev/null & H+=($!); done
for i in $(seq 1 10); do
  s=$(date +%s)
  taskset -c 10-11 /root/verify/pr13115/mvn.sh -o surefire:test -Djacoco.skip=true \
    '-Dtest=DurableRuntimeRecoveryTest#lostHandoffRenewsBeforeTheFirstRecoverLost+adoptCasSurvivesARenewalTickInItsWindow,RuntimeBrokerServiceTest#resourceRecoveryPastOneLeaseKeepsItsClaimAlive+settledStepStopsItsRenewal' > $OUT/run-$i.log 2>&1
  echo -e "$i\t$?\t$(( $(date +%s)-s ))s\t$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $OUT/run-$i.log | tail -1)" >> $OUT/results.tsv
  grep -E '\[ERROR\]   ' $OUT/run-$i.log >> $OUT/failures.txt
done
for p in "${H[@]}"; do kill $p; done
echo DONE >> $OUT/results.tsv
