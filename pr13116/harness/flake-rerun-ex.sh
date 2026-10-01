#!/bin/bash
# Whole-suite cell rerun with surefire's own flaky-test retry, to separate load flakes from kills.
# A failure caused by the mutant reproduces on every retry and still fails the build; a flake passes
# on retry and is reported as "Flakes: N". usage: flake-rerun.sh <worktree> <m2> <arm> <ids...>
set -u
. /Users/wenshao/pr13116-rig/scripts/env.sh
W=$1; M2=$2; ARM=$3; shift 3
TSV=$RIG/results/matrix-full-$ARM.tsv; : > $TSV
for M in "$@"; do
  [ "$M" != M0 ] && { node $RIG/scripts/mutate.mjs $RIG/$W $M > /dev/null || { printf '%s\t%s\tAPPLY-FAILED\n' $ARM $M | tee -a $TSV; continue; }; }
  L=$RIG/out/mx-full-$ARM-$M.log
  mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$RIG/$M2 -f $RIG/$W/$MA/pom.xml -Dsurefire.rerunFailingTestsCount=2 -Dsurefire.excludesFile=$RIG/results/excludes-toolpublication.txt clean test > $L 2>&1; RC=$?
  [ "$M" != M0 ] && { node $RIG/scripts/mutate.mjs $RIG/$W restore > /dev/null || { echo "RESTORE FAILED"; exit 9; }; }
  T=$(/usr/bin/grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+(, Flakes: [0-9]+)?$' $L | tail -1 | sed -E 's/^\[[A-Z]+\] //')
  FL=$(/usr/bin/grep -E '^\[WARNING\] Flakes:' -A3 $L | /usr/bin/grep -oE '[A-Za-z]+Test\.[A-Za-z]+' | sort -u | tr '\n' ' ')
  F=$(/usr/bin/grep -E '^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+:[0-9]+' $L | sed -E 's/^\[ERROR\]   //; s/[:( ].*//' | sort -u | tr '\n' ' ')
  V=survived; [ $RC -ne 0 ] && V=killed; [ -z "$T" ] && V=NO-TOTALS
  printf '%s\t%s\t%s\t%s\t%s\tflaky-retried: %s\n' "$ARM" "$M" "$V" "$T" "$F" "$FL" | tee -a $TSV
done
echo "FLAKE-RERUN-DONE $ARM"
