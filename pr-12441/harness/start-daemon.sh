#!/usr/bin/env bash
# usage: start-daemon.sh <tag> <port> <workspace>...
R=/root/verify/pr12441; H=/root/verify/pr12441-head
TAG=$1; PORT=$2; shift 2
WS_ARGS=(); for w in "$@"; do WS_ARGS+=(--workspace "$w"); done
cd "$1"
exec env -u QWEN_HOME HOME=$R/home QWEN_HOME=$R/home/.qwen \
  OPENAI_API_KEY=sk-fake OPENAI_BASE_URL=http://127.0.0.1:18480/v1 OPENAI_MODEL=fake-model \
  NODE_EXTRA_CA_CERTS=$R/rig/tls/ca.pem NODE_OPTIONS="--require $R/rig/dns-shim.cjs" \
  QWEN_CODE_NO_RELAUNCH=1 QWEN_SANDBOX=false \
  node $H/dist/cli.js serve --port $PORT --token pr12441-token "${WS_ARGS[@]}" > $R/rig/daemon-$TAG.log 2>&1
