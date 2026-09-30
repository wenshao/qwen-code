#!/bin/bash
# VERIFICATION RIG ONLY: the whole probe set against one arm.  usage: run-round2.sh <arm> <db> <sport> <bport> <set>   (set: core | limits | durability | real)
set -u
. /rig/rig.env
ARM=$1; DB=$2; export ARM DB SPORT=$3 BPORT=$4; SET=$5
cd $RIG/probe; mkdir -p $RIG/out/$DB
P() { echo ">>> $*"; $NODE "$@" > $RIG/out/$DB/.last.console 2>&1; grep -a -E "^(FAIL|== RESULT)" $RIG/out/$DB/.last.console | cut -c1-260; }
case $SET in
core)
  P s1-testplan.mjs b c
  for x in "external-edit d" "directory-path e" "parent-is-file f" "symlink g" "two-sessions i" "shell-chmod j" "shell-format k"; do P s4-refusals.mjs $x; done
  for x in "cold-missing-backup l" "live-missing-backup m" "store-fail-prepare n" "tool-error o" "undo-refusal-lease p" "cancel q" "unknown-snapshot r" "undo-rewind-reply-lost s" "undo-release-reply-lost t" "undo-busy u" "admission w"; do P s2-faults.mjs $x; done
  for x in "multi-prompt i2" "bytes j2" "shell-profile k2"; do P s7-semantics.mjs $x; done
  P s3-profiles.mjs m2
  P s6-durability.mjs volume-lost c2
  ;;
limits)
  P s5-limits.mjs record y 40
  P s5-limits.mjs record z 10
  P s5-limits.mjs record a2 20
  P s5-limits.mjs receipts v2 40
  P s5-limits.mjs snapshots b2
  ;;
durability)
  P s6-durability.mjs harness-kill d2
  P s6-durability.mjs mysql-restart e2
  P s6-durability.mjs mysql-kill f2
  ;;
real)
  P s8-real.mjs script n2,o2,p2,q2,r2
  P s8-real.mjs config s2,u2
  ;;
r2)
  for x in "special-names s3" "undo-retry-after-release t3" "transient-backup-access u3" "readonly-drift v3" "w1a-cold-load w3"; do P s14-r2.mjs $x; done
  ;;
esac
echo "SET $SET DONE $(date -u +%T)"
