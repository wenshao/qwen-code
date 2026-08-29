#!/usr/bin/env bash
# Real-daemon probe: POST /sessions/unarchive for a session that is ALREADY
# ACTIVE while another process holds that session's writer lease.
#   usage: daemon-e2e-livelease.sh <worktree> <label> <port>
set -uo pipefail

TREE="$1"; LABEL="$2"; PORT="$3"
SID="550e8400-e29b-41d4-a716-4466554400f1"
ROOT=$(cd "$(mktemp -d "/tmp/pr10300-live-XXXXXX")" && pwd -P)
export QWEN_HOME="$ROOT/home"
WS="$ROOT/workspace"
mkdir -p "$QWEN_HOME" "$WS"

PROJDIR=$(cd "$TREE" && node --input-type=module -e "
const { Storage } = await import('./packages/core/dist/src/config/storage.js');
process.stdout.write(new Storage(process.argv[1]).getProjectDir());
" "$WS")
CHATS="$PROJDIR/chats"
mkdir -p "$CHATS/archive"
cat > "$CHATS/$SID.jsonl" <<EOF
{"uuid":"record-1","parentUuid":null,"sessionId":"$SID","timestamp":"2024-01-01T00:00:00.000Z","type":"user","message":{"role":"user","parts":[{"text":"hello"}]},"cwd":"$WS","version":"1.0.0"}
EOF

echo "=============================================================="
echo "  Already-active unarchive while a live writer lease is held - $LABEL"
echo "  tree : $TREE"
echo "=============================================================="
echo
echo "  session $SID is ACTIVE (chats/$SID.jsonl)"
echo

# Hold a real writer lease from a separate process for the whole probe.
cat > "$ROOT/hold-lease.mjs" <<EOF
const { SessionService } = await import('$TREE/packages/core/dist/index.js');
const svc = new SessionService(process.argv[2]);
const lease = await svc.acquireSessionWriterLease(process.argv[3], {
  processKind: 'daemon',
  reclaimPolicy: 'never',
});
console.log('lease-held');
await new Promise((resolve) => setTimeout(resolve, 120000));
await lease.release().catch(() => {});
EOF
node "$ROOT/hold-lease.mjs" "$WS" "$SID" > "$ROOT/lease.log" 2>&1 &
HOLDER=$!
for _ in $(seq 1 60); do
  grep -q lease-held "$ROOT/lease.log" 2>/dev/null && break
  perl -e 'select(undef,undef,undef,0.3)'
done
if ! grep -q lease-held "$ROOT/lease.log" 2>/dev/null; then
  echo "!! lease holder failed"; cat "$ROOT/lease.log"; kill $HOLDER 2>/dev/null; exit 1
fi
LOCK=$(ls "$QWEN_HOME"/tmp/session-writer-locks/ 2>/dev/null | head -1)
echo "  a second process holds the writer lease  (lock file: $LOCK)"
echo

node "$TREE/dist/cli.js" serve --workspace "$WS" --port "$PORT" --no-web \
  > "$ROOT/daemon.log" 2>&1 &
DAEMON=$!
trap 'kill $DAEMON $HOLDER 2>/dev/null; wait $DAEMON $HOLDER 2>/dev/null' EXIT
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  perl -e 'select(undef,undef,undef,0.5)'
done
if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "!! daemon did not come up"; tail -30 "$ROOT/daemon.log"; exit 1
fi

echo "--- POST /sessions/unarchive -------------------------------"
echo "    request : {\"sessionIds\":[\"$SID\"]}"
RESP=$(curl -sS -X POST "http://127.0.0.1:$PORT/sessions/unarchive" \
  -H 'content-type: application/json' -d "{\"sessionIds\":[\"$SID\"]}")
echo "    response: $RESP"
echo
echo "=============================================================="
if echo "$RESP" | grep -q '"alreadyActive":\["'"$SID"'"\]'; then
  echo "  RESULT: idempotent success - id reported in alreadyActive"
else
  echo "  RESULT: request now FAILS for this id - reported in errors"
fi
echo "=============================================================="
