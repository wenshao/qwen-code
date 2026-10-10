#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): actual guest OS reboot between the held detach and recovery.  usage: reboot.sh <db> <jar-arm> <dist-arm>
source /Users/wenshao/pr13673-rig/rig.sh
D=$1; A=$2; DI=$3
echo "#### $D jar=$A dist=$DI fault=reboot $(date -u +%T)"
clean || exit 1
up $D $A $DI
probe $D $A $DI FAULT=reboot PHASE=prep
grep -q "fault point reached" $R/results/$D/recover-reboot-prep.log || { echo "prep failed"; exit 1; }
B0=$(X "cat /proc/sys/kernel/random/boot_id")
T0=$(date +%s)
colima stop pr13673 2>&1 | tail -1
colima start pr13673 --activate=false 2>&1 | tail -1
for i in $(seq 1 90); do docker --context colima-pr13673 exec pr13673-db mysqladmin -uroot -p$(cat $R/lx/.dbpass) ping >/dev/null 2>&1 && break; sleep 2; done
B1=$(X "cat /proc/sys/kernel/random/boot_id")
echo "boot $B0 -> $B1 after $(( $(date +%s) - T0 ))s; processes in lx: $(nprocs)"
X "$R/lx/aux.sh $D" > /dev/null
probe $D $A $DI FAULT=reboot PHASE=resume
down $D
