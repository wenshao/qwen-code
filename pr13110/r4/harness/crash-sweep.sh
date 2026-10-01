#!/bin/bash
# VERIFICATION RIG ONLY: crash sweep. usage: [POINTS="k:letter ..."] crash-sweep.sh <arm> <db> <sport> <bport>
set -u
. /rig/rig.env
ARM=$1; DB=$2; export ARM DB SPORT=$3 BPORT=$4
cd $RIG/probe; mkdir -p $RIG/out/$DB
for x in ${POINTS:-4:a3 5:b3 6:c3 7:d3 8:e3 9:f3 10:l3 11:g3 12:h3 13:i3 14:k3}; do
  k=${x%%:*}; l=${x##*:}
  $NODE s15-r3.mjs crash-at-$k $l > $RIG/out/$DB/.crash-$k.console 2>&1
  grep -a -E "^(== CRASH|FAIL)" $RIG/out/$DB/.crash-$k.console | cut -c1-600
done
echo "SWEEP DONE $(date -u +%T)"
