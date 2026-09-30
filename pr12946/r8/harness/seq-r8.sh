#!/bin/bash
cd <scratch>
r() { env "$@" ARM=06c1df7f bash rig/run.sh <scratch>/wt-pr <scratch>/runs/r10 $SCEN > /dev/null 2>&1; echo "$SCEN done" >> <scratch>/runs/r10/seq.txt; }
SCEN=s3t-list-changed-tools.ts r S3_WS=4 S3_KIND=tools
SCEN=s9-recovery.ts r S9_WS=6
SCEN=s7-outage.ts r S7_WS=0 S7_MODE=sse-restart
SCEN=s7h-http-down-close.ts r S7_WS=2
SCEN=s23a-make-orphan.ts r S23_WS=3
SCEN=s23-orphan-reload.ts r S23_WS=3
SCEN=s15-worker-kill-mcp.ts r S15_WS=5
echo SEQ_DONE >> <scratch>/runs/r10/seq.txt
