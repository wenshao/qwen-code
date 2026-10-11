#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): run the moved-head cells (arm4b) before the base battery. Stops r2.sh by PID
# when it reaches "## battery m3", stops that battery's stack by PID files, then runs arm4b.sh and b3.sh in order.
R=/root/v13682/rig; L=$R/out/reorder.log; : > $L; R2PID=$1
until grep -q "## battery m3" $R/out/r2.log; do sleep 3; done
kill $R2PID; echo "stopped r2.sh pid=$R2PID at $(date -u +%T)" >> $L; sleep 2
for db in r2m3; do bash $R/stop.sh $db spring-c >> $L 2>&1; bash $R/stop.sh $db all >> $L 2>&1; done
sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13682/rig/dist/\")==1 {print \$1}"); echo "leftover rig workers: $(echo $W | wc -w)" >> $L; [ -n "$W" ] && kill $W
rm -rf $R/run/r2m3
echo "r2.sh: base battery moved to b3.sh ($(date -u +%T))" >> $R/out/r2.log
bash $R/arm4b.sh; echo "arm4b rc=$? $(date -u +%T)" >> $L
bash $R/b3.sh; echo "b3 rc=$? $(date -u +%T)" >> $L
