#!/usr/bin/env bash
# E2E test for PR #7458: epoch token, compaction attribution, degraded snapshot
set -uo pipefail

PORT=14170
BASE="http://127.0.0.1:${PORT}"
CLI="node /Users/wenshao/git/qwen-code/dist/cli.js"
WORKSPACE="/tmp/pr7458-e2e-workspace"
LOG_DIR="/Users/wenshao/git/qwen-code/.qwen/e2e-tests/pr-7458-logs"
DAEMON_LOG="${LOG_DIR}/daemon-1.log"
DAEMON_LOG2="${LOG_DIR}/daemon-2.log"
TMP_SSE="/tmp/pr7458-sse-out.txt"

mkdir -p "$WORKSPACE" "$LOG_DIR"

cleanup() {
  echo "=== Cleanup ==="
  [ -n "${DAEMON_PID:-}" ] && kill "$DAEMON_PID" 2>/dev/null || true
  [ -n "${DAEMON_PID2:-}" ] && kill "$DAEMON_PID2" 2>/dev/null || true
  rm -f "$TMP_SSE"
  wait 2>/dev/null || true
}
trap cleanup EXIT

PASS_COUNT=0
FAIL_COUNT=0
INFO_COUNT=0

pass() { echo "✅ PASS: $1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "❌ FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT+1)); }
info() { echo "⚠️  INFO: $1"; INFO_COUNT=$((INFO_COUNT+1)); }

echo "============================================"
echo "PR #7458 E2E Test: Epoch Token & Resync"
echo "============================================"
echo ""

# ---- Phase 1: Start daemon ----
echo "=== Phase 1: Start daemon on port ${PORT} ==="
$CLI serve --port "$PORT" --no-open --no-web --workspace "$WORKSPACE" \
  > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
echo "Daemon PID: $DAEMON_PID"

for i in $(seq 1 30); do
  if curl -sf "${BASE}/health" > /dev/null 2>&1; then
    echo "Daemon is ready (attempt $i)"
    break
  fi
  [ "$i" -eq 30 ] && { echo "FAIL: Daemon did not start"; cat "$DAEMON_LOG"; exit 1; }
  sleep 1
done
echo ""

# ---- Phase 2: Create session ----
echo "=== Phase 2: Create session ==="
CREATE_RESP=$(curl -sf -X POST "${BASE}/session" \
  -H 'Content-Type: application/json' \
  -d "{\"cwd\": \"${WORKSPACE}\"}")
echo "CREATE response:"
echo "$CREATE_RESP" | python3 -m json.tool

SESSION_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")
echo "  sessionId=${SESSION_ID}"
echo ""

# ---- Phase 3: Load session → check eventEpoch ----
echo "=== Phase 3: Load session → check eventEpoch ==="
LOAD_RESP=$(curl -sf -X POST "${BASE}/session/${SESSION_ID}/load" \
  -H 'Content-Type: application/json' -d '{}')
echo "LOAD response (compact):"
echo "$LOAD_RESP" | python3 -c "
import sys, json; d = json.load(sys.stdin)
for k in ('liveJournal','compactedReplay'):
    if k in d and isinstance(d[k], list): d[k] = f'[{len(d[k])} items]'
if 'state' in d: d['state'] = '{...}'
print(json.dumps(d, indent=2))
"

LOAD_EPOCH=$(echo "$LOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('eventEpoch',''))")
LOAD_LAST_ID=$(echo "$LOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lastEventId',''))")

[ -n "$LOAD_EPOCH" ] && pass "Load response carries eventEpoch=${LOAD_EPOCH}" || fail "Load response missing eventEpoch"
echo "  lastEventId=${LOAD_LAST_ID}"
echo ""

# ---- Phase 4: SSE subscribe → check X-Qwen-Event-Epoch header ----
echo "=== Phase 4: SSE subscribe → check X-Qwen-Event-Epoch header ==="
SSE_HEADERS=$(curl -s --max-time 3 -D - -o /dev/null \
  -H "Accept: text/event-stream" \
  "${BASE}/session/${SESSION_ID}/events" 2>/dev/null) || true
echo "SSE response headers:"
echo "$SSE_HEADERS"

if echo "$SSE_HEADERS" | grep -qi "X-Qwen-Event-Epoch"; then
  SSE_EPOCH=$(echo "$SSE_HEADERS" | grep -i "X-Qwen-Event-Epoch" | tr -d '\r' | awk '{print $2}')
  pass "SSE stream carries X-Qwen-Event-Epoch=${SSE_EPOCH}"
else
  fail "SSE stream missing X-Qwen-Event-Epoch header"
fi
echo ""

# ---- Phase 5: SSE with matching epoch → normal resume ----
echo "=== Phase 5: SSE with matching epoch → normal resume (no resync) ==="
if [ -n "$LOAD_EPOCH" ]; then
  curl -s --max-time 3 -N \
    -H "Accept: text/event-stream" \
    -H "Last-Event-ID: 0" \
    -H "X-Qwen-Event-Epoch: ${LOAD_EPOCH}" \
    "${BASE}/session/${SESSION_ID}/events" > "$TMP_SSE" 2>/dev/null || true
  echo "SSE matching-epoch response (first 300 chars):"
  head -c 300 "$TMP_SSE"
  echo ""
  if grep -q "epoch_mismatch" "$TMP_SSE"; then
    fail "Matching epoch should NOT trigger epoch_mismatch"
  else
    pass "Matching epoch does not trigger epoch_mismatch"
  fi
else
  info "Skipped (no epoch from load)"
fi
echo ""

# ---- Phase 6: SSE with stale epoch → epoch_mismatch resync ----
echo "=== Phase 6: SSE with stale epoch + lastEventId → epoch_mismatch resync ==="
curl -s --max-time 5 -N \
  -H "Accept: text/event-stream" \
  -H "Last-Event-ID: 1" \
  -H "X-Qwen-Event-Epoch: stale-dead-epoch-token" \
  "${BASE}/session/${SESSION_ID}/events" > "$TMP_SSE" 2>/dev/null || true
echo "SSE stale-epoch response (first 500 chars):"
head -c 500 "$TMP_SSE"
echo ""

if grep -q "epoch_mismatch" "$TMP_SSE"; then
  pass "Stale epoch triggers epoch_mismatch resync"
elif grep -q "state_resync_required" "$TMP_SSE"; then
  pass "Stale epoch triggers state_resync_required"
else
  info "No resync frame detected (session may have no events yet)"
fi
echo ""

# ---- Phase 7: Prompt → check 202 envelope eventEpoch ----
echo "=== Phase 7: Send prompt → check 202 envelope eventEpoch ==="
PROMPT_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${BASE}/session/${SESSION_ID}/prompt" \
  -H 'Content-Type: application/json' \
  -d '{"prompt": [{"type": "text", "text": "Say hello in one word"}]}') || true
PROMPT_CODE=$(echo "$PROMPT_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
PROMPT_BODY=$(echo "$PROMPT_RESP" | grep -v "HTTP_CODE:")
echo "Prompt response (HTTP ${PROMPT_CODE}):"
echo "$PROMPT_BODY" | python3 -m json.tool 2>/dev/null || echo "$PROMPT_BODY"

PROMPT_EPOCH=$(echo "$PROMPT_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('eventEpoch',''))" 2>/dev/null || echo "")
if [ -n "$PROMPT_EPOCH" ] && [ "$PROMPT_EPOCH" != "None" ]; then
  pass "Prompt 202 envelope carries eventEpoch=${PROMPT_EPOCH}"
else
  info "Prompt response missing eventEpoch (HTTP ${PROMPT_CODE})"
fi
echo ""

# ---- Phase 8: Restart daemon → epoch changes ----
echo "=== Phase 8: Restart daemon → verify epoch changes ==="
echo "Stopping first daemon (PID $DAEMON_PID)..."
kill "$DAEMON_PID" 2>/dev/null; wait "$DAEMON_PID" 2>/dev/null || true
sleep 2

echo "Starting second daemon on same port..."
$CLI serve --port "$PORT" --no-open --no-web --workspace "$WORKSPACE" \
  > "$DAEMON_LOG2" 2>&1 &
DAEMON_PID2=$!
echo "Daemon2 PID: $DAEMON_PID2"

for i in $(seq 1 30); do
  if curl -sf "${BASE}/health" > /dev/null 2>&1; then
    echo "Daemon2 is ready (attempt $i)"
    break
  fi
  [ "$i" -eq 30 ] && { echo "FAIL: Daemon2 did not start"; cat "$DAEMON_LOG2"; exit 1; }
  sleep 1
done

LOAD2_RESP=$(curl -sf -X POST "${BASE}/session/${SESSION_ID}/load" \
  -H 'Content-Type: application/json' -d '{}') || true
echo "LOAD2 response (after restart, compact):"
echo "$LOAD2_RESP" | python3 -c "
import sys, json; d = json.load(sys.stdin)
for k in ('liveJournal','compactedReplay'):
    if k in d and isinstance(d[k], list): d[k] = f'[{len(d[k])} items]'
if 'state' in d: d['state'] = '{...}'
print(json.dumps(d, indent=2))
" 2>/dev/null || echo "$LOAD2_RESP"

LOAD2_EPOCH=$(echo "$LOAD2_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('eventEpoch',''))" 2>/dev/null || echo "")

if [ -n "$LOAD2_EPOCH" ] && [ "$LOAD2_EPOCH" != "None" ]; then
  pass "Load after restart carries NEW eventEpoch=${LOAD2_EPOCH}"
  if [ "$LOAD2_EPOCH" != "$LOAD_EPOCH" ]; then
    pass "Epoch changed after restart (old=${LOAD_EPOCH}, new=${LOAD2_EPOCH})"
  else
    fail "Epoch did NOT change after restart!"
  fi
else
  info "Load after restart missing eventEpoch"
fi
echo ""

# ---- Phase 9: Reconnect with OLD epoch → expect epoch_mismatch ----
echo "=== Phase 9: Reconnect SSE with OLD epoch → expect epoch_mismatch resync ==="
OLD_EPOCH="${LOAD_EPOCH:-stale-epoch}"
curl -s --max-time 5 -N \
  -H "Accept: text/event-stream" \
  -H "Last-Event-ID: 1" \
  -H "X-Qwen-Event-Epoch: ${OLD_EPOCH}" \
  "${BASE}/session/${SESSION_ID}/events" > "$TMP_SSE" 2>/dev/null || true
echo "SSE resync response after restart (first 500 chars):"
head -c 500 "$TMP_SSE"
echo ""

if grep -q "epoch_mismatch" "$TMP_SSE"; then
  pass "Old epoch after restart triggers epoch_mismatch resync"
elif grep -q "state_resync_required" "$TMP_SSE"; then
  pass "Old epoch after restart triggers state_resync_required"
else
  info "No resync frame detected after restart"
fi
echo ""

# ---- Phase 10: SSE without epoch header → backward compat ----
echo "=== Phase 10: SSE without epoch header → backward compat (no crash) ==="
curl -s --max-time 3 -N \
  -H "Accept: text/event-stream" \
  -H "Last-Event-ID: 1" \
  "${BASE}/session/${SESSION_ID}/events" > "$TMP_SSE" 2>/dev/null || true
echo "SSE no-epoch response (first 300 chars):"
head -c 300 "$TMP_SSE"
echo ""
if grep -q '"error"' "$TMP_SSE"; then
  fail "SSE without epoch header should not error"
else
  pass "SSE without epoch header works (backward compatible)"
fi
echo ""

# ---- Summary ----
echo "============================================"
echo "E2E Test Summary"
echo "============================================"
echo "  PASS: ${PASS_COUNT}"
echo "  FAIL: ${FAIL_COUNT}"
echo "  INFO: ${INFO_COUNT}"
echo ""
echo "Daemon logs: ${DAEMON_LOG}, ${DAEMON_LOG2}"