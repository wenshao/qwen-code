#!/usr/bin/env bash
# run-arm.sh <arm-name> <driver.mjs> <hold-ms>
# Drives the REAL built `qwen serve` daemon with the given serve-ab-drive.mjs,
# with the ACP child's initialize response delayed by <hold-ms>.
set -uo pipefail
ARM="$1"; DRIVER="$2"; HOLD="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"
WT=/root/git/qwen-code-pr13270
OUT="$HERE/arms/$ARM"
rm -rf "$OUT"; mkdir -p "$OUT"
: > "$OUT/shim.log"
start=$(date +%s.%N)
(
  cd "$WT"
  QWEN_CLI_ENTRY="$HERE/slow-acp-shim.cjs" \
  SLOW_ACP_REAL_ENTRY="$WT/packages/cli/dist/index.js" \
  SLOW_ACP_INIT_HOLD_MS="$HOLD" \
  SLOW_ACP_LOG="$OUT/shim.log" \
  node "$DRIVER" packages/cli/dist/index.js "$OUT/capture"
) > "$OUT/driver.log" 2>&1
rc=$?
end=$(date +%s.%N)
printf 'arm=%s driver=%s hold_ms=%s exit=%s wall_s=%.1f\n' "$ARM" "$DRIVER" "$HOLD" "$rc" "$(awk "BEGIN{print $end-$start}")" | tee "$OUT/result.txt"
# Reap any real ACP child the shim spawned that outlived its daemon (by recorded PID only).
sleep 1
for pid in $(grep -oE 'real ACP child pid=[0-9]+' "$OUT/shim.log" | grep -oE '[0-9]+$'); do
  if kill -0 "$pid" 2>/dev/null; then echo "leftover real ACP child $pid — killing" | tee -a "$OUT/result.txt"; kill "$pid"; fi
done
exit 0
