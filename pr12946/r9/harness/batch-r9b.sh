#!/bin/bash
TREE=$1; R=$2; ARM=$3
S=$(cd "$(dirname "$0")/.." && pwd)
run() { env "$@" ARM=$ARM bash $S/rig/run.sh $TREE $R $SCEN > /dev/null 2>&1; }
( SCEN=s1c-happy.ts run S1_WS=0; SCEN=s3t-list-changed-tools.ts run S3_WS=1 S3_KIND=tools; SCEN=s5-cancel.ts run S4_WS=2 S4_MODE=prompt; SCEN=s20-busy-owner-cleanup.ts run S20_WS=3; SCEN=s17f-discover-503-r7.ts run S17_WS=4; echo A_DONE >> $R/batch.txt ) &
( SCEN=s25b-value.ts run S25_WS=5 S25_CASE=value; SCEN=s32n-acquire-nodetach.ts run S32_WS=6 S32_WINDOW=acquire S32_DETACH=0; SCEN=s32-dispatch.ts run S32_WS=7 S32_WINDOW=dispatch; SCEN=s33q-approval-quick.ts run S33_WS=8 S33_DELAY_S=2; SCEN=s30-proto-notify.ts run S30_WS=9 S30_METHODS=toString,__proto__; echo B_DONE >> $R/batch.txt ) &
( SCEN=s29s-release-undelivered-single.ts run S29_WS=10; SCEN=s29-release-undelivered.ts run S29_WS=11 S29_SERVERS=remote,legacy; SCEN=s21b-hung-raw-op.ts run S21_WS=12 S21_SERVER=short S21_WAIT_S=40; SCEN=s9-recovery.ts run S9_WS=13; SCEN=s23a-make-orphan.ts run S23_WS=14; echo C_DONE >> $R/batch.txt ) &
wait
SCEN=s28-config-during-turn.ts run S28_WS=15 S28_TRIES=4
SCEN=s31b-sticky-multi.ts run S31_WS=16 S31_SERVERS=sticky,remote S31_TRIES=6
SCEN=s31-sticky-detach.ts run S31_WS=17
SCEN=s26-reload-stuck.ts run S26_TARGETS="14:$(grep -o '"sessionId":"[^"]*"' $R/s23a-make-orphan.log | tail -1 | cut -d'"' -f4):remote"
echo ALL_DONE >> $R/batch.txt
