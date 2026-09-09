#!/usr/bin/env bash
# tui-run.sh <arm: base|pr> <port>
set -u
ARM=$1; PORT=$2
H=/root/git/h11483
WT=$([ "$ARM" = base ] && echo /root/git/base11483 || echo /root/git/pr11483)
cd "$H/workspace"
env -i PATH=/usr/bin:/bin:/usr/local/bin HOME="$H/home" TERM=xterm-256color \
  OPENAI_API_KEY=sk-harness \
  OPENAI_BASE_URL="http://127.0.0.1:$PORT/v1" \
  OPENAI_MODEL=mock-model \
  QWEN_CODE_DISABLE_UPDATE_CHECK=1 \
  node "$WT/dist/cli.js"
