#!/bin/bash
# VERIFICATION RIG ONLY: main matrix for one arm.  usage: batch-n4.sh <db> <tag> [quick]
set -u
DB=$1; TAG=$2; P=/Users/wenshao/pr13163-rig/probe; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
L=/Users/wenshao/pr13163-rig/out/$DB/batch-$TAG.log; mkdir -p $(dirname $L); : > $L
run() { echo "### $*" >> $L; (cd $P && env DB=$DB "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
run $N c1-cancel-refused.mjs ws-a a revoke alice
run $N c1-cancel-refused.mjs ws-b b draining alice
run $N c1-cancel-refused.mjs ws-c c regen alice
run env RESTORE=early $N c1-cancel-refused.mjs ws-ea a revoke alice
run env RESTORE=early $N c1-cancel-refused.mjs ws-eb b draining alice
if [ "${3:-}" != quick ]; then
run $N c1-cancel-refused.mjs ws-d d storage alice
run $N c1-cancel-refused.mjs ws-e e unread alice
run $N c1-cancel-refused.mjs ws-f f control alice
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control bob
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control carol
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g control mallory
run env HOLD=15000 $N c1-cancel-refused.mjs ws-g g revoke bob
fi
run $N c5-regen-admission.mjs ws-c5a a regen
run $N c5-regen-admission.mjs ws-c5b b storage
run $N c7-replay-order.mjs ws-c7 c
for f in respond400 respond404 respond500 drop-before; do run $N c8-rename-refused.mjs bound ws-c8 d $f; done
for f in respond400 respond500; do run $N c8-rename-refused.mjs unbound - - $f; done
if [ "${3:-}" != quick ]; then
run $N c3-lost-delivery.mjs bound ws-c3 e drop-before 1
run $N c3-lost-delivery.mjs unbound - - drop-before 1
fi
echo "BATCH-DONE $(date -u +%T)" >> $L
