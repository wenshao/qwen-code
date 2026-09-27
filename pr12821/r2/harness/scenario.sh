#!/bin/bash
# Usage: scenario.sh <name> "<gen args after root>" '<extra host config json>' [cancelAfterSec]
# Starts a real host, drives it with curl, stops it (SIGTERM), then runs the successor reader.
set -u
H=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-/Users/wenshao/git/qwen-code-pr12821}
NAME=$1; GENARGS=$2; EXTRA=${3:-'{}'}; CANCEL_AFTER=${4:-}
OUT=$H/out/$NAME; rm -rf "$OUT"; mkdir -p "$OUT"
ROOT=$(mktemp -d /tmp/pr12821-$NAME-XXXX)
LOG=$OUT/driver.log
say() { echo "$@" | tee -a "$LOG"; }
say "## $NAME  head=$(git -C "$REPO" rev-parse --short HEAD) dirty=$(git -C "$REPO" status --short | wc -l | tr -d ' ') root=$ROOT"
CMD="node $H/gen.mjs $ROOT $GENARGS"
jq -n --arg repo "$REPO" --arg root "$ROOT" --arg cmd "$CMD" --argjson extra "$EXTRA" \
  '{repo:$repo, root:$root, command:$cmd} + $extra' > "$OUT/host.json"
node "$H/host.mjs" "$OUT/host.json" > "$OUT/host.out" 2> "$OUT/host.err" &
HOST=$!
for i in $(seq 1 300); do grep -q READY "$OUT/host.out" 2>/dev/null && break; sleep 0.2; done
ORIGIN=$(awk '/READY/{print $2}' "$OUT/host.out"); DIG=$(awk -F'argsDigest=' '/READY/{print $2}' "$OUT/host.out")
say "host pid=$HOST origin=$ORIGIN"
hdr=(-H 'authorization: Bearer test-token' -H 'x-qwen-managed-lease-id: lease-a' -H 'x-qwen-managed-lease-epoch: 1' -H 'content-type: application/json' -H 'cache-control: no-store')
REF=$(jq -nc --arg d "$DIG" '{sessionId:"runtime-session-a",promptId:"turn-a",callId:"call-a",argsDigest:$d}')
EXEC=$(jq -nc --argjson ref "$REF" --arg cmd "$CMD" '{protocolVersion:3,toolResult:"managed-tool-result/1",reference:$ref,toolName:"run_shell_command",input:{command:$cmd},capture:{tenantId:"tenant-a",sessionId:"session-a",turnId:"turn-a",executionCallId:"execution-a",bindingGeneration:"1",capturePolicy:"complete_required"}}')
post() { curl -sS -o "$OUT/$1.json" -w '%{http_code} %{time_total}s' "${hdr[@]}" -X POST "$ORIGIN/internal/managed-runtime/v3/$2" -d "$3"; }
if [ -n "$CANCEL_AFTER" ]; then
  ( post execute execute "$EXEC" > "$OUT/execute.code" ) &
  CURL=$!
  for i in $(seq 1 200); do [ -s "$ROOT/side-effects.log" ] && break; sleep 0.1; done
  sleep "$CANCEL_AFTER"
  say "cancel -> $(post cancel cancel "$(jq -nc --argjson ref "$REF" '{protocolVersion:3,toolResult:"managed-tool-result/1",reference:$ref}')") $(jq -c '{state}' "$OUT/cancel.json")"
  wait $CURL
  say "execute -> $(cat "$OUT/execute.code")"
else
  say "execute -> $(post execute execute "$EXEC")"
fi
say "  $(jq -c '{state, executionStatus:.result.executionStatus, capture:(.result.capture|if .==null then null else {captureStatus,captureReason,deliveryStatus,previewTruncated,manifest:(.manifest|if .==null then null else {byteLength} end)} end)}' "$OUT/execute.json" 2>/dev/null || cat "$OUT/execute.json")"
say "checkpoint -> $(curl -sS "$ORIGIN/_probe/checkpoint" | jq -c .)"
# Duplicate execute (same identity) must not rerun the command.
if kill -0 $HOST 2>/dev/null; then
  say "execute (repeat) -> $(post execute2 execute "$EXEC")  identical=$(cmp -s "$OUT/execute.json" "$OUT/execute2.json" && echo yes || echo no)"
  STATUS=$(jq -nc --argjson ref "$REF" '{protocolVersion:3,toolResult:"managed-tool-result/1",reference:$ref}')
  say "status -> $(post status status "$STATUS") $(jq -c '{state,lastSequence,deliveryStatus:.result.capture.deliveryStatus}' "$OUT/status.json")"
  REC=$(curl -sS "$ORIGIN/_probe/checkpoint" >/dev/null; jq -c '.result.capture as $c | {executionCallId:"execution-a", manifest:$c.manifest, deliveryStatus:$c.deliveryStatus}' "$OUT/execute.json")
fi
say "side-effect runs so far: $(wc -l < "$ROOT/side-effects.log" 2>/dev/null | tr -d ' ')"
echo "$ROOT" > "$OUT/root"
echo "$ORIGIN" > "$OUT/origin"
echo "$HOST" > "$OUT/hostpid"
