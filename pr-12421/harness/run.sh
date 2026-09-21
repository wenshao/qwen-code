#!/usr/bin/env bash
# Usage: run.sh <arm: base|pr> <proto: chat|responses|anthropic> <scenario-name> [port]
# Runs one headless CLI session against the scripted mock.
set -u
ARM=$1; PROTO=$2; SCN=$3; PORT=${4:-18700}
H=/root/verify/pr12421-harness
CLI=/root/verify/pr12421-arms/$ARM/cli.js
TAG="$ARM-$PROTO-$SCN"
LOG=$H/logs/$TAG.wire.jsonl
OUT=$H/out/$TAG.stream.jsonl
ERR=$H/out/$TAG.stderr.txt
HOMEDIR=$H/home-$TAG
rm -rf "$HOMEDIR"; mkdir -p "$HOMEDIR"

node $H/mock.mjs $PORT $H/scn-$SCN.json $LOG > $H/logs/$TAG.mock.txt 2>&1 &
MOCK=$!
for i in $(seq 1 50); do grep -q MOCK_READY $H/logs/$TAG.mock.txt 2>/dev/null && break; sleep 0.1; done
grep -q MOCK_READY $H/logs/$TAG.mock.txt || { echo "mock failed"; kill $MOCK; exit 1; }

case $PROTO in
  chat) AUTH=(--auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:$PORT/v1) ;;
  responses) AUTH=(--auth-type openai-responses --openai-api-key dummy --openai-base-url http://127.0.0.1:$PORT/v1) ;;
  anthropic) AUTH=(--auth-type anthropic) ;;
esac

cd $H/ws
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy -u NO_COLOR \
  HOME=$HOMEDIR QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
  ANTHROPIC_BASE_URL=http://127.0.0.1:$PORT ANTHROPIC_API_KEY=dummy \
  timeout 180 node $CLI -p "PR12421 scenario $SCN: run the scripted read_file calls." \
  --approval-mode yolo "${AUTH[@]}" --model mock-model -o stream-json > $OUT 2> $ERR
EXIT=$?
kill $MOCK 2>/dev/null
echo "$TAG exit=$EXIT wire=$(wc -l < $LOG) stream=$(wc -l < $OUT)"
