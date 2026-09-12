#!/bin/bash
# Run one arm of the PR #11690 verification against the real bundled CLI.
#
#   run-arm.sh <arm-name> <bundle-dir> [extra env assignments...]
#
# Environment knobs consumed by the provider (see provider.mjs):
#   RIG_CKPT_POLICY, RIG_CKPT_MAX_BYTES, RIG_CKPT_DELAY_MS,
#   RIG_TOOL_CALLS_PER_TURN, RIG_TOOL_TURNS, RIG_BLOB_BYTES
# and by this script:
#   RIG_WALL_SECONDS   hard stop for the CLI run (default 420)
#   RIG_GOAL           objective text
set -u
ARM="$1"; BUNDLE="$2"; shift 2
BASEDIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${RIG_OUT:-$BASEDIR/../runs}/$ARM"
rm -rf "$OUT"; mkdir -p "$OUT/home" "$OUT/ws"
export RIG_DIR="$OUT"
: > "$OUT/ledger.jsonl"

node "$BASEDIR/provider.mjs" > "$OUT/provider.log" 2>&1 &
PROVIDER_PID=$!
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

GOAL="${RIG_GOAL:-Collect probe outputs from the workspace shell and report them. Completion checks: (1) at least sixty probe outputs are recorded as evidence.}"

export QWEN_HOME="$OUT/home"
export OPENAI_API_KEY=rig-key
export OPENAI_BASE_URL="http://127.0.0.1:$PORT/v1"
export OPENAI_MODEL=rig-main
export QWEN_CODE_DISABLE_UPDATE_CHECK=1
export NO_COLOR=1
python3 -c 'import time; print(time.time())' > "$OUT/start-epoch"
set -m
node "$BUNDLE/dist/cli.js" -p "/goal $GOAL" --output-format stream-json ${RIG_CLI_ARGS:-} \
  > "$OUT/cli.stdout.jsonl" 2> "$OUT/cli.stderr.log" &
CLI_PID=$!
set +m
echo "[$ARM] cli pid=$CLI_PID"

WALL="${RIG_WALL_SECONDS:-420}"
END=$((SECONDS + WALL))
while kill -0 "$CLI_PID" 2>/dev/null; do
  if [ $SECONDS -ge $END ]; then
    echo "[$ARM] wall limit reached, terminating cli"
    kill -TERM -"$CLI_PID" 2>/dev/null
    sleep 3
    kill -KILL -"$CLI_PID" 2>/dev/null
    break
  fi
  sleep 1
done
wait "$CLI_PID" 2>/dev/null
CLI_RC=$?
python3 -c "import time,sys; print(round(time.time()-float(open('$OUT/start-epoch').read()),2))" > "$OUT/wall-seconds"
kill -TERM "$PROVIDER_PID" 2>/dev/null
echo "[$ARM] cli exit=$CLI_RC"
echo "$CLI_RC" > "$OUT/cli.exit"
