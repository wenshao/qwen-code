#!/bin/bash
# usage: run-mode.sh <label> <cwd-dir> <runner-file> [runner args...]
# env passed through: G3_VERIFY_MODE PROBE_QWEN_MD PROBE_DUMP_DIR PROBE_BASE_RELAX
set -uo pipefail
LABEL=$1; CWD=$2; RUNNER=$3; shift 3
R=/root/pr13777-rig
OUT=$R/runs/$LABEL
rm -rf "$OUT"; mkdir -p "$OUT/tmp"
ENVARGS=(-e QWEN_MANAGED_E2E_KEEP_TMP=1 -e G3_VERIFY_REPORT_DIR=$OUT/report)
for v in G3_VERIFY_MODE $(compgen -v PROBE_); do
  [ -n "${!v:-}" ] && ENVARGS+=(-e "$v=${!v}")
done
START=$(date +%s)
docker run --rm --init --name "pr13777-run-$LABEL" --network none --cpus 4 --memory 8g \
  -v /etc/machine-id:/etc/machine-id:ro -v $R:$R -v "$OUT/tmp":/tmp \
  "${ENVARGS[@]}" -w "$CWD" --entrypoint bash qwen-managed-e2e:u24 \
  -c "$R/src-head/node_modules/.bin/tsx $RUNNER $*" > "$OUT/console.log" 2>&1
RC=$?
echo "RESULT label=$LABEL rc=$RC seconds=$(( $(date +%s) - START )) args=$*" | tee -a "$OUT/console.log" >> $R/runs/RESULTS.txt
exit $RC
