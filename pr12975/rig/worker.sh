#!/bin/sh
# Launch wrapper used by LocalProcessRuntimeProvisioner in the rig.
MODE="$1"
RIG_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "$(date +%H:%M:%S) tag=${RIG_TAG:-none} mode=$MODE pid=$$" >> "$RIG_DIR/launches.log"
BOOT="$RIG_DIR/boots/${RIG_TAG:-none}-$$.json"
cat > "$BOOT"
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
BUNDLE=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/wt-merge/dist/cli.js
case "$MODE" in
  real) exec $NODE "$BUNDLE" managed-runtime-worker < "$BOOT" ;;
  # A real Worker booted with another storage ID: it attests that ID.
  tamper) $NODE -e 'const f=process.argv[1];const b=JSON.parse(require("fs").readFileSync(f,"utf8"));b.storageId="storage:tampered/1";require("fs").writeFileSync(f,JSON.stringify(b));' "$BOOT"; exec $NODE "$BUNDLE" managed-runtime-worker < "$BOOT" ;;
  hang) exec sleep 600 ;;
  *) echo "unknown mode $MODE" >&2; exit 2 ;;
esac
