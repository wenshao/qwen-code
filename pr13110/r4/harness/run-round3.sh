#!/bin/bash
# VERIFICATION RIG ONLY: round-3 probe sets.  usage: run-round3.sh <arm> <db> <sport> <bport> <set>
set -u
. /rig/rig.env
ARM=$1; DB=$2; export ARM DB SPORT=$3 BPORT=$4; SET=$5
cd $RIG/probe; mkdir -p $RIG/out/$DB
P() { echo ">>> $*"; $NODE "$@" > $RIG/out/$DB/.last.console 2>&1; grep -a -E "^(PASS|FAIL|NOTE|== RESULT)" $RIG/out/$DB/.last.console | cut -c1-330; }
case $SET in
rebase)
  for x in "rebase-external-edit m3" "rebase-untouched-drift n3" "rebase-delete o3" "rebase-mode p3" "shell-same-and-next q3" "two-sessions-undo r3" "busy-tracked-file x3"; do P s15-r3.mjs $x; done ;;
settle)
  for x in "settle-store-503 ${L1:-y3}" "settle-shell-kill ${L2:-z3}" "reservation-conflict ${L3:-h}"; do P s15-r3.mjs $x; done ;;
legacy)
  P s15-r3.mjs legacy-pending v ;;
core)
  P s1-testplan.mjs b c
  for x in "external-edit d" "directory-path e" "parent-is-file f" "symlink g" "two-sessions i" "shell-chmod j" "shell-format k" "shell-touch a2" "shell-chmod-only g2"; do P s4-refusals.mjs $x; done
  for x in "cold-missing-backup l" "live-missing-backup m" "store-fail-prepare n" "tool-error o" "undo-refusal-lease p" "cancel q" "unknown-snapshot r" "undo-rewind-reply-lost t2" "undo-release-reply-lost w2" "undo-busy x2" "admission w"; do P s2-faults.mjs $x; done
  for x in "multi-prompt i2" "bytes j2" "shell-profile k2"; do P s7-semantics.mjs $x; done
  P s3-profiles.mjs m2
  P s6-durability.mjs volume-lost c2 ;;
r2)
  for x in "special-names s3" "undo-retry-after-release t3" "transient-backup-access u3" "readonly-drift v3" "w1a-cold-load w3"; do P s14-r2.mjs $x; done ;;
limits)
  P s5-limits.mjs record y 40
  P s5-limits.mjs record z 10
  P s5-limits.mjs record h2 20
  P s5-limits.mjs receipts v2 40
  P s5-limits.mjs snapshots b2 ;;
durability)
  P s6-durability.mjs harness-kill d2
  P s6-durability.mjs mysql-restart e2
  P s6-durability.mjs mysql-kill f2 ;;
esac
echo "SET $SET DONE $(date -u +%T)"
