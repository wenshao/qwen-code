#!/usr/bin/env bash
# Usage: run-real.sh <arm> <proto: chat|responses> <tag> <prompt>
set -u
ARM=$1; PROTO=$2; TAG=$3; PROMPT=$4
H=/root/verify/pr12421-harness
HOMEDIR=$H/home-real-$ARM-$PROTO-$TAG; rm -rf $HOMEDIR; mkdir -p $HOMEDIR
AUTHT=openai; [ "$PROTO" = responses ] && AUTHT=openai-responses
KEY=$(jq -r .env.CLIPROXY_API_KEY ~/.qwen/settings.json)
cd $H/ws
start=$(date +%s)
env -u NO_COLOR HOME=$HOMEDIR QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
  OPENAI_API_KEY="$KEY" \
  timeout 420 node /root/verify/pr12421-arms/$ARM/cli.js -p "$PROMPT" --approval-mode yolo \
  --auth-type $AUTHT --openai-base-url <GPT_PROXY_BASE_URL> --model gpt-5.6-luna \
  -o stream-json > $H/out/real-$ARM-$PROTO-$TAG.stream.jsonl 2> $H/out/real-$ARM-$PROTO-$TAG.stderr.txt
echo "real-$ARM-$PROTO-$TAG exit=$? secs=$(( $(date +%s)-start ))"
