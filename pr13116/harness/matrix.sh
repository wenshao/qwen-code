#!/bin/bash
# Mutation matrix. usage: matrix.sh <worktree> <m2> <arm> <scope: targeted|full> <mutant ids...>
# Each mutant: apply -> clean test -> restore (restore must leave production clean).
set -u
. /Users/wenshao/pr13116-rig/scripts/env.sh
W=$1; M2=$2; ARM=$3; SCOPE=$4; shift 4
TSV=$RIG/results/matrix-$SCOPE-$ARM.tsv; : > $TSV
TESTS=()
[ "$SCOPE" = targeted ] && TESTS=(-Dtest=ManagedAgentPropertiesTest,QwenHostedHarnessConnectorTest)
for M in "$@"; do
  if [ "$M" != M0 ]; then node $RIG/scripts/mutate.mjs $RIG/$W $M > $RIG/out/mx-$SCOPE-$ARM-$M.apply 2>&1 || { printf '%s\t%s\tAPPLY-FAILED\n' $ARM $M | tee -a $TSV; continue; }; fi
  $RIG/scripts/run.sh $W $M2 mx-$SCOPE-$ARM-$M ${TESTS[@]+"${TESTS[@]}"} clean test > $RIG/out/mx-$SCOPE-$ARM-$M.console 2>&1
  [ "$M" != M0 ] && { node $RIG/scripts/mutate.mjs $RIG/$W restore > /dev/null || { echo "RESTORE FAILED $W"; exit 9; }; }
  L=$RIG/out/mx-$SCOPE-$ARM-$M.log
  T=$(/usr/bin/grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L | tail -1 | sed -E 's/^\[[A-Z]+\] //')
  F=$(/usr/bin/grep -E '^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+:[0-9]+' $L | sed -E 's/^\[ERROR\]   //; s/[:( ].*//' | sort -u | tr '\n' ' ')
  V=survived; case "$T" in *"Failures: 0, Errors: 0"*) ;; "") V=NO-TOTALS;; *) V=killed;; esac
  printf '%s\t%s\t%s\t%s\t%s\n' "$ARM" "$M" "$V" "$T" "$F" | tee -a $TSV
done
echo "MATRIX-DONE $SCOPE $ARM"
