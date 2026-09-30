#!/bin/bash
# IT-lane mutation matrix: HostedPublicWorkspaceIT (real Spring + bundled Harness + Runtime Broker workers) per mutant.
# usage: it-matrix.sh <worktree> <arm label> <db> <mutant ids...>     (M0 = unmutated control)
set -u
. /Users/wenshao/pr13095-rig/scripts/env.sh
W=$1; ARM=$2; DB=$3; shift 3
TSV=$RIG/results/it-matrix-$ARM-$DB.tsv; [ -f $TSV ] || : > $TSV
for M in "$@"; do
  if [ "$M" != M0 ]; then node $RIG/scripts/mutate.mjs $RIG/$W $M || { echo "RESULT itmx $ARM $M APPLY-FAILED"; continue; }; fi
  $RIG/scripts/it.sh $W mx-$ARM-$DB-$M $DB > $RIG/out/it/mx-$ARM-$DB-$M.console 2>&1
  [ "$M" != M0 ] && node $RIG/scripts/mutate.mjs $RIG/$W restore > /dev/null
  L=$RIG/out/it/mx-$ARM-$DB-$M.log
  T=$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+.*HostedPublicWorkspaceIT' $L | tail -1 | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//')
  AT=$(grep -oE 'HostedPublicWorkspaceIT\.publicCreationRunsFilesThroughProductionWorkspaceBinding\(HostedPublicWorkspaceIT\.java:[0-9]+\)' $L | head -1 | grep -oE ':[0-9]+' | tr -d ':')
  MSG=$(grep -A3 -E '^\[ERROR\] .*HostedPublicWorkspaceIT\.publicCreation.* -- Time elapsed' $L | sed -n '2,4p' | tr -s ' \n' ' ' | cut -c1-200)
  V=survived; case "$T" in *"Failures: 0, Errors: 0"*) ;; "") V=NO-TOTALS;; *) V=killed;; esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$ARM" "$DB" "$M" "$V" "$T" "${AT:-}" "$MSG" | tee -a $TSV
done
echo "IT-MATRIX-DONE $ARM $DB"
