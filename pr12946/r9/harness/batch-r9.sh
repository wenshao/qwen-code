#!/bin/bash
# batch-r9.sh <tree> <run> <arm>
TREE=$1; R=$2; ARM=$3
S=$(cd "$(dirname "$0")/.." && pwd)
run() { env "$@" ARM=$ARM bash $S/rig/run.sh $TREE $R $SCEN > /dev/null 2>&1; }
( SCEN=s1c-happy.ts run S1_WS=0; SCEN=s2-shared-workspace.ts run S2_WS=1; SCEN=s10-intent-close.ts run X=1; SCEN=s16-quota.ts run X=1; echo A_DONE >> $R/batch.txt ) &
( SCEN=s3t-list-changed-tools.ts run S3_WS=4 S3_KIND=tools; SCEN=s3r-list-changed-resources.ts run S3_WS=5; SCEN=s4-cancel.ts run S4_WS=6 S4_MODE=op; SCEN=s5-cancel.ts run S4_WS=7 S4_MODE=prompt; SCEN=s6-cancel.ts run S4_WS=8 S4_MODE=timeout; SCEN=s6b-cancel.ts run S4_WS=9 S4_MODE=timeout S4_SERVER=short; echo B_DONE >> $R/batch.txt ) &
( SCEN=s8b-quotas.ts run S8_A=10 S8_B=11; SCEN=s11-replace.ts run S11_WS=13; SCEN=s19-duplicate-reply.ts run S19_WS=15; SCEN=s20-busy-owner-cleanup.ts run S20_WS=16; SCEN=s17f-discover-503-r7.ts run S17_WS=17; SCEN=s21b-hung-raw-op.ts run S21_WS=21 S21_SERVER=short S21_WAIT_S=40; echo C_DONE >> $R/batch.txt ) &
wait
SCEN=s9-recovery.ts run S9_WS=12
SCEN=s7-outage.ts run S7_WS=18 S7_MODE=sse-restart
SCEN=s7h-http-down-close.ts run S7_WS=19
SCEN=s23a-make-orphan.ts run S23_WS=22
echo ALL_DONE >> $R/batch.txt
