#!/bin/bash
# Usage: run.sh <out-subdir> <client-model> [scenario ...]
set -u
E2E="$(cd "$(dirname "$0")" && pwd)"
OUT_ROOT="$E2E/out/$1"
MODEL="$2"
shift 2
SCENARIOS=("$@")
if [ ${#SCENARIOS[@]} -eq 0 ]; then
  SCENARIOS=(reconnect content-outage terminal-outage create-outage nonretryable dispose cost latency-order)
fi
mkdir -p "$OUT_ROOT"
for variant in head base; do
  case "$variant" in
    head) TREE=/Users/wenshao/git/qwen-10357 ;;
    base) TREE=/Users/wenshao/git/qwen-10357-base ;;
  esac
  for s in "${SCENARIOS[@]}"; do
    echo "--- $variant/$s (client model $MODEL) ---"
    (cd "$TREE" && SRC_DIR="$TREE/packages/channels/dingtalk/src" \
      OUT_DIR="$OUT_ROOT" VARIANT="$variant" CLIENT_MODEL="$MODEL" \
      ./node_modules/.bin/tsx "$E2E/harness.mts" "$s" 2>&1 | grep -E '^(PASS|FAIL|Error|.*Error:)' )
  done
done
