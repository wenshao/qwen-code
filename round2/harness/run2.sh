#!/bin/bash
set -u
SCRATCH=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/d31f0d4a-0c2a-4996-ae34-b28a057efc3c/scratchpad
H="$SCRATCH/assets/harness/harness.mts"
OUT="$SCRATCH/out/$1"; MODEL="$2"; VARIANTS="$3"; shift 3
SCEN=("$@")
if [ ${#SCEN[@]} -eq 0 ]; then
  SCEN=(reconnect content-outage terminal-outage create-outage nonretryable dispose cost latency-order slow-create cost-large boundary-slow-create)
fi
mkdir -p "$OUT"
for variant in $VARIANTS; do
  case "$variant" in
    head) TREE=$SCRATCH/wt-head ;;
    base) TREE=$SCRATCH/wt-base ;;
  esac
  for s in "${SCEN[@]}"; do
    echo "--- $variant/$s ($MODEL) ---"
    (cd "$TREE" && SRC_DIR="$TREE/packages/channels/dingtalk/src" \
      OUT_DIR="$OUT" VARIANT="$variant" CLIENT_MODEL="$MODEL" \
      ./node_modules/.bin/tsx "$H" "$s" 2>&1 | grep -E '^(PASS|FAIL|Error|.*Error:)' )
  done
done
echo "RUN DONE"
