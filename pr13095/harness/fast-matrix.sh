#!/bin/bash
# Fast-lane mutation matrix: full managed-agent-server surefire suite per mutant.
# usage: fast-matrix.sh <worktree> <arm label> <mutant ids...>
set -u
. /Users/wenshao/pr13095-rig/scripts/env.sh
W=$1; ARM=$2; shift 2
TSV=$RIG/results/fast-matrix-$ARM.tsv; : > $TSV
for M in "$@"; do
  if [ "$M" != M0 ]; then node $RIG/scripts/mutate.mjs $RIG/$W $M || { echo "RESULT fastmx $ARM $M APPLY-FAILED"; continue; }; fi
  $RIG/scripts/fast.sh $W $ARM-$M > $RIG/out/fast/$ARM-$M.console 2>&1
  [ "$M" != M0 ] && node $RIG/scripts/mutate.mjs $RIG/$W restore > /dev/null
  L=$RIG/out/fast/$ARM-$M.log
  T=$(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L | tail -1 | sed -E 's/^\[[A-Z]+\] //')
  F=$(grep -E '^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+:[0-9]+' $L | sed -E 's/^\[ERROR\]   //; s/ .*//' | sort -u | tr '\n' ' ')
  V=survived; case "$T" in *"Failures: 0, Errors: 0"*) ;; "") V=NO-TOTALS;; *) V=killed;; esac
  printf '%s\t%s\t%s\t%s\t%s\n' "$ARM" "$M" "$V" "$T" "$F" | tee -a $TSV
done
echo "FAST-MATRIX-DONE $ARM"
