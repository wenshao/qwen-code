#!/bin/bash
# container: run a list of S2 scenarios ("mode:fault") for one arm.  usage: s2-batch.sh <arm> <mode:fault>...
ARM=$1; shift
mkdir -p /w/rig && cp /rig/rig/*.ts /rig/rig/package.json /w/rig/
for spec in "$@"; do
  mode=${spec%%:*}; fault=${spec##*:}
  L=$ARM-$mode-$fault
  s=$(date +%s)
  tsx /w/rig/s2-takeover.ts $L $mode $fault > $RIG_OUT/$L.console 2>&1; rc=$?
  echo "[$L] exit=$rc $(( $(date +%s) - s ))s terminal=$(grep -m1 '"terminal"' $RIG_OUT/$L.console | tr -d ' ,')"
done
echo "[$ARM] BATCH-DONE"
