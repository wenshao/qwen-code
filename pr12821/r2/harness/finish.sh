#!/bin/bash
# Usage: finish.sh <name>  — ACK probes (if host alive), SIGTERM host, successor reader.
set -u
H=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-/Users/wenshao/git/qwen-code-pr12821}
NAME=$1; OUT=$H/out/$NAME; LOG=$OUT/driver.log
ROOT=$(cat "$OUT/root"); ORIGIN=$(cat "$OUT/origin"); HOST=$(cat "$OUT/hostpid")
say() { echo "$@" | tee -a "$LOG"; }
hdr=(-H 'authorization: Bearer test-token' -H 'x-qwen-managed-lease-id: lease-a' -H 'x-qwen-managed-lease-epoch: 1' -H 'content-type: application/json' -H 'cache-control: no-store')
post() { curl -sS -o "$OUT/$1.json" -w '%{http_code}' "${hdr[@]}" -X POST "$ORIGIN/internal/managed-runtime/v3/$2" -d "$3"; }
if kill -0 "$HOST" 2>/dev/null; then
  DIG=$(awk -F'argsDigest=' '/READY/{print $2}' "$OUT/host.out")
  REF=$(jq -nc --arg d "$DIG" '{sessionId:"runtime-session-a",promptId:"turn-a",callId:"call-a",argsDigest:$d}')
  REV=$(curl -sS "$ORIGIN/_probe/checkpoint" | jq -r '[.events[] | select(endswith(":tool.receipt")) | split(":")[0] | tonumber] | first // "null"')
  DS=$(jq -r '.result.capture.deliveryStatus // empty' "$OUT/execute.json")
  if [ -n "$DS" ]; then
    HR=$([ "$DS" = committed ] && echo "$REV" || echo null)
    ACK=$(jq -nc --argjson ref "$REF" --argjson hr "$HR" --arg ds "$DS" --argjson m "$(jq -c '.result.capture.manifest' "$OUT/execute.json")" \
      '{protocolVersion:3,toolResult:"managed-tool-result/1",reference:$ref,receipt:{executionCallId:"execution-a",manifest:$m,deliveryStatus:$ds,historyRevision:$hr}}')
    say "ack(receipt seq=$REV, $DS) -> $(post ack acknowledge "$ACK") $(jq -c '{state,deliveryStatus:.result.capture.deliveryStatus,code}' "$OUT/ack.json")"
    say "ack repeat identical -> $(post ack2 acknowledge "$ACK") $(jq -c '{state,code}' "$OUT/ack2.json")"
    if [ "$DS" = committed ]; then
      ACKX=$(echo "$ACK" | jq -c '.receipt.historyRevision += 1')
      say "ack changed historyRevision -> $(post ack3 acknowledge "$ACKX") $(jq -c '{code}' "$OUT/ack3.json")"
    else
      ACKX=$(echo "$ACK" | jq -c --argjson hr "$REV" '.receipt.deliveryStatus="committed" | .receipt.historyRevision=($hr // 1)')
      say "ack upgraded blocked->committed -> $(post ack3 acknowledge "$ACKX") $(jq -c '{code}' "$OUT/ack3.json")"
    fi
  fi
  kill -TERM "$HOST"; for i in $(seq 1 100); do kill -0 "$HOST" 2>/dev/null || break; sleep 0.2; done
  say "host stopped: $(tail -1 "$OUT/host.out")"
else
  say "host already gone (pid $HOST)"
fi
MREF=$(jq -c '.result.capture.manifest // empty' "$OUT/execute.json" 2>/dev/null)
say "successor reader (new process, writer lease as worker-b, O1b read-only):"
node "$H/reader.mjs" "$REPO" "$ROOT" ${MREF:+"$MREF"} > "$OUT/reader.json" 2> "$OUT/reader.err"
cat "$OUT/reader.json" | tee -a "$LOG"
[ -s "$OUT/reader.err" ] && { say "reader stderr:"; head -20 "$OUT/reader.err" | tee -a "$LOG"; }
say "## end $NAME head=$(git -C "$REPO" rev-parse --short HEAD)"
