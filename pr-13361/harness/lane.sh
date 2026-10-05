#!/usr/bin/env bash
# Usage: lane.sh <lane> <jobfile>; each job line: <label> <arm> <STALL_MS> <STALL_NTH> [ENV=VAL ...]
LANE=$1; JOBS=$2
while read -r LABEL ARM MS NTH REST; do
  [ -z "$LABEL" ] && continue
  avail=$(df --output=avail -BG / | tail -1 | tr -dc 0-9); [ "$avail" -lt 8 ] && { echo "disk floor hit" >> /root/verify/pr13361/runs/lane-$LANE.log; break; }
  STALL_MS=$MS STALL_NTH=$NTH timeout 900 /root/verify/pr13361/harness/run-it.sh "$LABEL" "$ARM" "$LANE" VERIFY_FAULT=stall VERIFY_FAULT_AT=2 $REST >> /root/verify/pr13361/runs/lane-$LANE.log 2>&1
done < "$JOBS"
echo LANE-DONE >> /root/verify/pr13361/runs/lane-$LANE.log
