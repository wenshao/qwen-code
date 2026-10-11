#!/bin/bash
# usage: run-mode.sh <label> <arm> [runner args...]
# The repo runner from src-<arm> (its Linux-built dist/cli.js + jar) in the e2e image, no network.
set -uo pipefail
LABEL=$1; A=$2; shift 2
R=/root/pr13332-rig; D=$R/src-$A
OUT=$R/runs/$LABEL
rm -rf "$OUT"; mkdir -p "$OUT/tmp"
START=$(date +%s)
docker run --rm --init --name "pr13332-run-$LABEL" --network none --cpus 4 --memory 8g \
  -v /etc/machine-id:/etc/machine-id:ro -v $R:$R -v "$OUT/tmp":/tmp \
  -e QWEN_MANAGED_E2E_KEEP_TMP=0 -w "$D" --entrypoint bash qwen-managed-e2e:u24 \
  -c "node_modules/.bin/tsx scripts/run-managed-agent-server-e2e.ts $*" > "$OUT/console.log" 2>&1
RC=$?
echo "RESULT label=$LABEL arm=$A rc=$RC seconds=$(( $(date +%s) - START )) load=$(cut -d" " -f1-3 /proc/loadavg) args=$*" | tee -a "$OUT/console.log" >> $R/runs/RESULTS.txt
exit $RC
