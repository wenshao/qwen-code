#!/bin/bash
# Round 2: ONE real `qwen serve` daemon built from head 5c4f1de (serves the head
# bundle on :4938) + two static proxies that forward every REST/SSE call to it:
#   :4939 base   = merge-base bc7a186 bundle
#   :4940 revert = head with fix commit 4860e0a7e6 reverse-applied
set -uo pipefail
H=/root/git/pr10938-harness
WT=/var/tmp/pr10938-wt
DPORT=4938; BPORT=4939; RPORT=4940; MPORT=4937
HOME_T=$H/run/home
WS=$H/run/ws
OUT=$H/out
killport() { local p; p=$(ss -tlnp | grep ":$1 " | grep -oP 'pid=\K[0-9]+' | head -1); [ -n "$p" ] && kill "$p" && sleep 1; }
killport "$DPORT"; killport "$BPORT"; killport "$RPORT"
if [ "${RESTART_MOCK:-0}" = 1 ]; then killport "$MPORT"; fi
if ! ss -tlnp | grep -q ":$MPORT "; then
  PORT=$MPORT OUT=$OUT setsid node "$H/fake-openai.cjs" >> "$OUT/mock.log" 2>&1 < /dev/null &
  sleep 0.5
fi
cd "$WS"
HOME="$HOME_T" OPENAI_API_KEY=mock OPENAI_BASE_URL="http://127.0.0.1:$MPORT/v1" OPENAI_MODEL=fake-model \
  QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
  setsid node "$WT/dist/cli.js" serve --port "$DPORT" --workspace "$WS" \
  >> "$H/r2/out/daemon.log" 2>&1 < /dev/null &
PORT=$BPORT DAEMON_PORT=$DPORT ROOT=/var/tmp/pr10938-ws-base-r2 setsid node "$H/base-proxy.cjs" >> "$H/r2/out/proxy-base.log" 2>&1 < /dev/null &
PORT=$RPORT DAEMON_PORT=$DPORT ROOT=/var/tmp/pr10938-ws-revert-r2 setsid node "$H/base-proxy.cjs" >> "$H/r2/out/proxy-revert.log" 2>&1 < /dev/null &
for i in $(seq 1 120); do
  sleep 0.5
  curl -s -m 2 "http://127.0.0.1:$DPORT/health" >/dev/null 2>&1 && break
done
echo "daemon=$DPORT base=$BPORT revert=$RPORT mock=$MPORT health=$(curl -s -m 3 http://127.0.0.1:$DPORT/health | head -c 160)"
