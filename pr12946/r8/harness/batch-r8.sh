#!/bin/bash
# batch-r8.sh <tree> <run> <arm> : three sequential groups in parallel
TREE=$1; R=$2; ARM=$3
S=$(cd "$(dirname "$0")/.." && pwd)
run() { env "$@" ARM=$ARM bash $S/rig/run.sh $TREE $R $SCEN > /dev/null 2>&1; }
( SCEN=s1c-happy.ts run X=1; SCEN=s2-shared-workspace.ts run S2_WS=1; SCEN=s10-intent-close.ts run X=1; SCEN=s16-quota.ts run X=1; echo A_DONE >> $R/batch.txt ) &
( SCEN=s3-list-changed.ts run S3_WS=4; SCEN=s3r-list-changed-resources.ts run S3_WS=5; SCEN=s4-cancel.ts run S4_WS=6 S4_MODE=op; SCEN=s5-cancel.ts run S4_WS=7 S4_MODE=prompt; SCEN=s6-cancel.ts run S4_WS=8 S4_MODE=timeout; SCEN=s6b-cancel.ts run S4_WS=9 S4_MODE=timeout S4_SERVER=short; echo B_DONE >> $R/batch.txt ) &
( SCEN=s8b-quotas.ts run S8_A=10 S8_B=11; SCEN=s9-recovery.ts run S9_WS=12; SCEN=s11-replace.ts run S11_WS=13; SCEN=s19-duplicate-reply.ts run S19_WS=15; SCEN=s20-busy-owner-cleanup.ts run S20_WS=16; SCEN=s17f-discover-503-r7.ts run S17_WS=17; echo C_DONE >> $R/batch.txt ) &
wait
echo ALL_DONE >> $R/batch.txt
