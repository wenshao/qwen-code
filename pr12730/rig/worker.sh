#!/bin/sh
# Launch wrapper used by LocalProcessRuntimeProvisioner in the rig.
# Logs every launch, captures the boot document, then behaves per mode.
MODE="$1"
RIG_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="${QWEN_BUNDLE:?}"
echo "$(date +%H:%M:%S) tag=${RIG_TAG:-none} mode=$MODE pid=$$ ppid=$PPID" >> "$RIG_DIR/launches.log"
case "$MODE" in
  crash-parent)
    # Simulate the Broker dying after persisting the resource handle and
    # before the worker ever starts: kill the JVM, launch nothing.
    kill -9 "$PPID"; exit 0 ;;
esac
BOOT="$RIG_DIR/boots/${RIG_TAG:-none}-$$.json"
cat > "$BOOT"
case "$MODE" in
  real) exec node "$BUNDLE" managed-runtime-worker < "$BOOT" ;;
  fail) exit 1 ;;
  hang) exec sleep 600 ;;
  late) sleep 12; echo "$(date +%H:%M:%S) tag=${RIG_TAG:-none} late-worker-exec pid=$$" >> "$RIG_DIR/events.log"; exec node "$BUNDLE" managed-runtime-worker < "$BOOT" ;;
  *) echo "unknown mode $MODE" >&2; exit 2 ;;
esac
