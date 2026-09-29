#!/bin/bash
# Repeats one fault-gate class on one arm and lists each run's result.
# usage: gate-repeat.sh <arm> <class> <times>
SCRATCH=/rig-home
ARM=$1; CLASS=$2; N=$3
WT=$SCRATCH/wt-$ARM; L=$SCRATCH/logs/gate-repeat-$ARM; mkdir -p $L
cd $WT || exit 1
for i in $(seq 1 $N); do
  load=$(sysctl -n vm.loadavg | awk '{print $2}')
  MVN_ARM=$ARM $SCRATCH/bin/mvnw.sh -o -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates -Dqwen.cli.entry=$WT/dist/cli.js -Dtest=$CLASS -Dsurefire.failIfNoSpecifiedTests=false -Djacoco.skip=true test > $L/$CLASS-$i.log 2>&1
  rc=$?
  line=$(sed 's/\x1b\[[0-9;]*m//g' $L/$CLASS-$i.log | grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" | tail -1)
  fail=$(sed 's/\x1b\[[0-9;]*m//g' $L/$CLASS-$i.log | grep -E "^\[ERROR\]   " | head -3 | tr '\n' ' ')
  echo "[$ARM] run $i load=$load rc=$rc $line $fail"
done
