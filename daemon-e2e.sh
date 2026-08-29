#!/usr/bin/env bash
# Real-daemon E2E for PR #10300.
#   usage: daemon-e2e.sh <worktree> <label> <port>
# Starts the bundled `qwen serve` against an isolated QWEN_HOME, seeds the
# exact residue state the bug leaves behind (transcript already archived,
# sidecars stranded in active/), issues a real POST /sessions/archive, and
# prints the response plus the on-disk tree before and after.
set -uo pipefail

TREE="$1"; LABEL="$2"; PORT="$3"
SID="550e8400-e29b-41d4-a716-4466554400e2"
ROOT=$(cd "$(mktemp -d "/tmp/pr10300-e2e-XXXXXX")" && pwd -P)
export QWEN_HOME="$ROOT/home"
WS="$ROOT/workspace"
mkdir -p "$QWEN_HOME" "$WS"

PROJDIR=$(cd "$TREE" && node --input-type=module -e "
const { Storage } = await import('./packages/core/dist/src/config/storage.js');
process.stdout.write(new Storage(process.argv[1]).getProjectDir());
" "$WS")
CHATS="$PROJDIR/chats"
mkdir -p "$CHATS/archive"

# Residue state: transcript already archived, sidecars stranded in active/.
cat > "$CHATS/archive/$SID.jsonl" <<EOF
{"uuid":"record-1","parentUuid":null,"sessionId":"$SID","timestamp":"2024-01-01T00:00:00.000Z","type":"user","message":{"role":"user","parts":[{"text":"hello"}]},"cwd":"$WS","version":"1.0.0"}
EOF
echo "{\"sessionId\":\"$SID\",\"worktreePath\":\"/tmp/wt\"}" > "$CHATS/$SID.worktree.json"
echo "{\"version\":1,\"prs\":[{\"platform\":\"github\",\"owner\":\"o\",\"repo\":\"r\",\"number\":1,\"url\":\"https://example.invalid/pr/1\"}]}" > "$CHATS/$SID.pr.json"
echo '{"kind":"prompt"}' > "$CHATS/$SID.ledger.jsonl"

echo "=============================================================="
echo "  qwen serve real-daemon E2E — $LABEL"
echo "  tree      : $TREE"
echo "  QWEN_HOME : $QWEN_HOME"
echo "=============================================================="
echo
echo "--- BEFORE: chats tree -------------------------------------"
(cd "$PROJDIR" && find chats -type f | sort | sed 's/^/    /')
echo

node "$TREE/dist/cli.js" serve --workspace "$WS" --port "$PORT" --no-web \
  > "$ROOT/daemon.log" 2>&1 &
DAEMON=$!
trap 'kill $DAEMON 2>/dev/null; wait $DAEMON 2>/dev/null' EXIT

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  perl -e 'select(undef,undef,undef,0.5)'
done
if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "!! daemon did not come up"; tail -30 "$ROOT/daemon.log"; exit 1
fi
echo "--- daemon up on 127.0.0.1:$PORT ---------------------------"
echo

echo "--- POST /sessions/archive ---------------------------------"
echo "    request : {\"sessionIds\":[\"$SID\"]}"
RESP=$(curl -fsS -X POST "http://127.0.0.1:$PORT/sessions/archive" \
  -H 'content-type: application/json' \
  -d "{\"sessionIds\":[\"$SID\"]}")
echo "    response: $RESP"
echo

echo "--- AFTER: chats tree --------------------------------------"
(cd "$PROJDIR" && find chats -type f | sort | sed 's/^/    /')
echo

STRANDED=$(cd "$CHATS" && ls "$SID".worktree.json "$SID".pr.json "$SID".ledger.jsonl 2>/dev/null | wc -l | tr -d ' ')
echo "=============================================================="
if [ "$STRANDED" = "0" ]; then
  echo "  RESULT: sidecars followed the transcript into chats/archive/"
  echo "          -> cleanup resumed, no residue"
else
  echo "  RESULT: $STRANDED sidecar(s) still stranded in chats/"
  echo "          -> residue survives the retry"
fi
echo "=============================================================="
