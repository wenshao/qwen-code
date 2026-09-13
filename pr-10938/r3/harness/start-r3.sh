#!/bin/bash
# Round 3: same ONE real `qwen serve` daemon build as round 2 (5c4f1de; every later
# commit touches web-shell client files only) + static proxies forwarding REST/SSE:
#   :4939 base    merge-base bc7a186 bundle
#   :4941 lanefix round-2 candidate patch on 5c4f1de (NOT the PR)
#   :4943 head2   5f70a13 (round-2 head)
#   :4944 head3   d91a0f7e (this round)
set -uo pipefail
H=/root/git/pr10938-harness
WT=/var/tmp/pr10938-wt
DPORT=4938; MPORT=4937
HOME_T=$H/run/home; WS=$H/run/ws; OUT=$H/out; LOG=$H/r3/out
killport() { local p; p=$(ss -tlnp | grep ":$1 " | grep -oP 'pid=\K[0-9]+' | head -1); [ -n "$p" ] && kill "$p" && sleep 1; }
for p in $DPORT 4939 4941 4943 4944; do killport $p; done
if ! ss -tlnp | grep -q ":$MPORT "; then
  PORT=$MPORT OUT=$OUT setsid node "$H/fake-openai.cjs" >> "$LOG/mock.log" 2>&1 < /dev/null &
  sleep 0.5
fi
cd "$WS"
HOME="$HOME_T" OPENAI_API_KEY=mock OPENAI_BASE_URL="http://127.0.0.1:$MPORT/v1" OPENAI_MODEL=fake-model \
  QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
  setsid node "$WT/dist/cli.js" serve --port "$DPORT" --workspace "$WS" >> "$LOG/daemon.log" 2>&1 < /dev/null &
proxy() { PORT=$1 DAEMON_PORT=$DPORT ROOT=$2 setsid node "$H/base-proxy.cjs" >> "$LOG/proxy-$1.log" 2>&1 < /dev/null & }
proxy 4939 /var/tmp/pr10938-ws-base-r2
proxy 4941 /var/tmp/pr10938-ws-lanefix-r2
proxy 4943 /var/tmp/pr10938-ws-head2-r2
[ -f /var/tmp/pr10938-ws-head3-r3/index.html ] && proxy 4944 /var/tmp/pr10938-ws-head3-r3
for i in $(seq 1 120); do sleep 0.5; curl -s -m 2 "http://127.0.0.1:$DPORT/health" >/dev/null 2>&1 && break; done
echo "health=$(curl -s -m 3 http://127.0.0.1:$DPORT/health | head -c 160)"
for p in 4939 4941 4943 4944; do echo ":$p $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/)"; done
