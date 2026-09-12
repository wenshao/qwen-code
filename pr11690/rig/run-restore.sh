#!/bin/bash
# Scenario D: a resumed session's checkpoint replay must be sent whole, even
# though the restored Goal carries a stall streak.
#
#   run-restore.sh <arm-name> <bundle-dir>
#
# Phase 1 runs a Goal until its checkpoint stall streak reaches
# RIG_STALL_TARGET, then kills the CLI. Phase 2 resumes the same session with
# --continue against the same provider, so the runtime replays the prepared
# checkpoint window at startup.
set -u
ARM="$1"; BUNDLE="$2"
BASEDIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${RIG_OUT:-$BASEDIR/../runs}/$ARM"
rm -rf "$OUT"; mkdir -p "$OUT/home" "$OUT/ws"
export RIG_DIR="$OUT"
: > "$OUT/ledger.jsonl"

node "$BASEDIR/provider.mjs" > "$OUT/provider.log" 2>&1 &
PROVIDER_PID=$!
trap 'kill -TERM "$PROVIDER_PID" 2>/dev/null' EXIT
for _ in $(seq 1 50); do [ -s "$OUT/port" ] && break; sleep 0.1; done
PORT="$(cat "$OUT/port")"
echo "[$ARM] provider pid=$PROVIDER_PID port=$PORT bundle=$BUNDLE"

cat > "$OUT/home/settings.json" <<JSON
{
  "\$version": 4,
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "name": "rig-main", "goalCheckpointTimeoutSeconds": ${RIG_CKPT_TIMEOUT_S:-180} },
  "fastModel": "rig-fast",
  "general": { "checkpointing": { "enabled": false } },
  "tools": { "approvalMode": "yolo" },
  "ui": { "theme": "Default" },
  "telemetry": { "enabled": false }
}
JSON
cat > "$OUT/home/trustedFolders.json" <<JSON
{ "$OUT/ws": "TRUST_FOLDER" }
JSON

cd "$OUT/ws"
git init -q . 2>/dev/null || true
echo "probe workspace for PR 11690" > README.md

export QWEN_HOME="$OUT/home"
export OPENAI_API_KEY=rig-key
export OPENAI_BASE_URL="http://127.0.0.1:$PORT/v1"
export OPENAI_MODEL=rig-main
export QWEN_CODE_DISABLE_UPDATE_CHECK=1
export NO_COLOR=1

GOAL="${RIG_GOAL:-Collect probe outputs from the workspace shell and report them. Completion checks: (1) at least sixty probe outputs are recorded as evidence.}"
STALL_TARGET="${RIG_STALL_TARGET:-1}"

echo "phase1" > "$OUT/phase"
set -m
node "$BUNDLE/dist/cli.js" -p "/goal $GOAL" --output-format stream-json \
  > "$OUT/p1.stdout.jsonl" 2> "$OUT/p1.stderr.log" &
CLI_PID=$!

# Kill the run as soon as the restored-from state is reached: an active Goal
# whose checkpoint stall streak is STALL_TARGET.
DEADLINE=$((SECONDS + ${RIG_WALL_SECONDS:-300}))
while kill -0 "$CLI_PID" 2>/dev/null; do
  if python3 - "$OUT/p1.stdout.jsonl" "$STALL_TARGET" <<'PY'
import json, sys
path, target = sys.argv[1], int(sys.argv[2])
try:
    lines = open(path).read().splitlines()
except OSError:
    sys.exit(1)
for line in lines:
    try:
        d = json.loads(line)
    except Exception:
        continue
    ev = d.get('event') or {}
    if d.get('type') == 'stream_event' and ev.get('type') == 'goal_state':
        g = ev['goal_state']['goal']
        if g.get('status') == 'active' and (g.get('checkpointStalls') or 0) >= target:
            sys.exit(0)
sys.exit(1)
PY
  then
    echo "[$ARM] stall streak $STALL_TARGET reached; stopping phase 1"
    kill -KILL -"$CLI_PID" 2>/dev/null || kill -KILL "$CLI_PID" 2>/dev/null
    break
  fi
  [ $SECONDS -ge $DEADLINE ] && { echo "[$ARM] phase1 deadline"; kill -KILL -"$CLI_PID" 2>/dev/null; break; }
  sleep 0.2
done
wait "$CLI_PID" 2>/dev/null
set +m
echo "[$ARM] phase 1 done"

# The killed run must be quiet before the resume starts, otherwise a surviving
# child would be mistaken for the replay.
sleep 6
QUIET_A=$(wc -l < "$OUT/ledger.jsonl")
sleep 4
QUIET_B=$(wc -l < "$OUT/ledger.jsonl")
echo "[$ARM] ledger lines $QUIET_A -> $QUIET_B (must be equal)"
echo "phase2" > "$OUT/phase"
CKPT_BEFORE=$(grep -c '"kind":"ckpt"' "$OUT/ledger.jsonl" || true)
echo "$CKPT_BEFORE" > "$OUT/ckpt-before-resume"
echo "[$ARM] checkpoint calls before resume: $CKPT_BEFORE"

set -m
node "$BUNDLE/dist/cli.js" --continue -p "/goal" --output-format stream-json \
  > "$OUT/p2.stdout.jsonl" 2> "$OUT/p2.stderr.log" &
CLI2=$!
DEADLINE=$((SECONDS + ${RIG_RESUME_SECONDS:-120}))
while kill -0 "$CLI2" 2>/dev/null; do
  [ $SECONDS -ge $DEADLINE ] && { echo "[$ARM] resume deadline"; kill -KILL -"$CLI2" 2>/dev/null; break; }
  sleep 1
done
wait "$CLI2" 2>/dev/null
echo "[$ARM] phase 2 done"
