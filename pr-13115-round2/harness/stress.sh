#!/bin/bash
# A/B census of the three previously flaky fault-gate classes.
# usage: stress.sh <label> <iterations> <cores> <hogs>
LABEL=$1; N=$2; CORES=$3; HOGS=$4
D=${STRESS_DIR:-/root/verify/pr13115/stress}
CLI=/root/verify/pr13115/head/dist/cli.js
OUT=$D/out/$LABEL; mkdir -p $OUT
HOGPIDS=()
for ((h=0; h<HOGS; h++)); do taskset -c $CORES yes > /dev/null & HOGPIDS+=($!); done
echo "hogs: ${HOGPIDS[*]}" > $OUT/hogs.txt
for ((i=1; i<=N; i++)); do
  set -- ${ARMS:-head base}; A=$1; B=$2
  for arm in $A $B; do
    [ $((i % 2)) -eq 0 ] && arm=$([ $arm = $A ] && echo $B || echo $A)
    cd $D/$arm/runtime-broker; [ -n "${FENCE:-}" ] && export CENSUS_FENCE_LOG=$OUT/fence-$arm.tsv
    start=$(date +%s)
    taskset -c $CORES /root/verify/pr13115/mvn.sh -o -Pfault-gates surefire:test -Djacoco.skip=true \
      -Dqwen.cli.entry=$CLI "-Dtest=${TESTS:-LocalRebootFaultGateTest,DurableLocalRuntimeFaultGateTest,ProcessCrashFaultGateTest}" \
      -Dcensus.file=$OUT/census-$arm.tsv -Dcensus.iter=$i ${EXTRA_ARGS:-} > $OUT/run-$arm-$i.log 2>&1
    rc=$?
    summary=$(grep -E '^\[(ERROR|WARNING|INFO)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $OUT/run-$arm-$i.log | tail -1)
    echo -e "$i\t$arm\t$rc\t$(( $(date +%s) - start ))s\t$summary" >> $OUT/results.tsv
    mkdir -p $OUT/reports-$arm-$i; cp target/surefire-reports/*.txt $OUT/reports-$arm-$i/ 2>/dev/null
  done
done
for p in "${HOGPIDS[@]}"; do kill $p; done
echo DONE >> $OUT/results.tsv
