#!/usr/bin/env bash
# Usage: run-real2.sh <arm> <provider: gpt|qwen> <tag> <prompt>
set -u
ARM=$1; PROV=$2; TAG=$3; PROMPT=$4
H=/root/verify/pr12421-harness
HOMEDIR=$H/home-r2-$ARM-$PROV-$TAG; rm -rf $HOMEDIR; mkdir -p $HOMEDIR
if [ $PROV = gpt ]; then URL=<GPT_PROXY_BASE_URL>; MODEL=gpt-5.6-luna; KEY=$(jq -r .env.CLIPROXY_API_KEY ~/.qwen/settings.json);
else URL=<DASHSCOPE_BASE_URL>; MODEL=qwen3.8-max; KEY=$(jq -r .env.DASHSCOP_REVIEW_AK ~/.qwen/settings.json); fi
cd $H/ws; start=$(date +%s)
env -u NO_COLOR HOME=$HOMEDIR QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 QWEN_CODE_SUPPRESS_YOLO_WARNING=1 OPENAI_API_KEY="$KEY" \
  timeout 420 node /root/verify/pr12421-arms/$ARM/cli.js -p "$PROMPT" --approval-mode yolo --auth-type openai --openai-base-url $URL --model $MODEL \
  -o stream-json > $H/out/r2-$ARM-$PROV-$TAG.stream.jsonl 2> $H/out/r2-$ARM-$PROV-$TAG.stderr.txt
echo "r2-$ARM-$PROV-$TAG exit=$? secs=$(( $(date +%s)-start ))"
