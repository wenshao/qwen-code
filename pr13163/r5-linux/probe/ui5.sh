#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): real Managed panel screenshots for one arm.  usage: ui5.sh <db> <arm>
R=/root/v13163/rig; DB=$1; ARM=$2; N=/usr/bin/node; L=$R/out/$DB/ui5-$ARM.log; mkdir -p $R/out/$DB; : > $L
run() { echo "### $*" >> $L; (cd $R/probe && env DB=$DB ARM=$ARM "$@" >> $L 2>&1); echo "RC=$?" >> $L; }
run $N c13-ui-cancel.mjs ws-u1-$ARM a revoke en
run $N c13-ui-cancel.mjs ws-u2-$ARM b draining zh
if [ "$ARM" = head ]; then
  run $N c13-ui-cancel.mjs ws-u3-$ARM c regen en
  run $N c13-ui-cancel.mjs ws-u4-$ARM d reader en
fi
echo "UI-DONE $(date -u +%T)" >> $L
