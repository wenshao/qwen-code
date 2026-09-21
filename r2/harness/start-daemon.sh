#!/bin/bash
# usage: start-daemon.sh <port>
H=/root/verify/pr12234-r2-harness
for v in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY no_proxy NO_PROXY; do unset $v; done
export HOME=$H/home QWEN_HOME=$H/home/.qwen QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1
export OPENAI_API_KEY=dummy OPENAI_BASE_URL=http://127.0.0.1:18234/v1 OPENAI_MODEL=dummy
cd $H/ws
exec node /root/verify/pr12234-r2-merged/dist/cli.js serve --port $1 --token verify-token-12234 --workspace $H/ws
