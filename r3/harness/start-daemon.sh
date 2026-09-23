#!/bin/bash
# usage: start-daemon.sh <port>
H=/var/tmp/pr12234-r3
for v in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY no_proxy NO_PROXY; do unset $v; done
export HOME=$H/home QWEN_HOME=$H/home/.qwen QWEN_RUNTIME_DIR=$H/rt QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1
export OPENAI_API_KEY=dummy OPENAI_BASE_URL=http://127.0.0.1:18234/v1 OPENAI_MODEL=dummy
cd $H/ws
echo $$ > $H/daemon.pid
exec node ${WORKTREE:?set WORKTREE to the merged-tree checkout}/dist/cli.js serve --port $1 --token verify-token-12234 --workspace $H/ws
