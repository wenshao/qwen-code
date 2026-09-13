#!/usr/bin/env bash
# Runs every E2E arm sequentially: one real daemon at a time, a fresh isolated
# HOME/workspace per arm, the driver, then the daemon is stopped by PID.
set -u
R=/root/git/pr11748-harness
E=$R/e2e
H=$R/head
O=$R/old-daemon
OUT=$E/out
mkdir -p "$OUT"
if [ -d "$H/packages/web-shell/dist" ] && [ ! -L "$H/packages/web-shell/dist" ]; then
  mv "$H/packages/web-shell/dist" "$H/packages/web-shell/dist.head-build"
fi

run_arm() { # name root ws-dist port scen [lang]
  local name=$1 root=$2 ws=$3 port=$4 scen=$5 lang=${6:-}
  echo "=== ARM $name scen=$scen port=$port lang=${lang:-default}"
  tmux kill-session -t "d-$name" 2>/dev/null
  tmux new-session -d -s "d-$name" "bash $E/start-daemon.sh $name $root $ws $port $lang > $OUT/daemon-$name.log 2>&1"
  for _ in $(seq 1 240); do curl -s -m 1 -o /dev/null "http://127.0.0.1:$port/health" && break; sleep 0.5; done
  sleep 1
  local pid
  pid=$(ss -ltnp | grep ":$port " | sed -E 's/.*pid=([0-9]+).*/\1/' | head -1)
  echo "daemon pid=$pid health=$(curl -s -m 2 "http://127.0.0.1:$port/health" | head -c 100)"
  echo "web_terminal capability: $(curl -s -m 5 "http://127.0.0.1:$port/capabilities" | grep -o '"web_terminal"' | head -1)"
  ARM=$name URL="http://127.0.0.1:$port" OUT="$OUT/$name" SCEN=$scen DPID=$pid node "$E/e2e11748.cjs"
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  for _ in $(seq 1 60); do ss -ltn | grep -q ":$port " || break; sleep 0.25; done
  sleep 1
  tmux kill-session -t "d-$name" 2>/dev/null
}

run_arm decrqm-head "$H" "$R/ws-head" 4411 decrqm
run_arm decrqm-base "$H" "$R/ws-base" 4411 decrqm
run_arm legacy-head "$O" "$R/ws-head" 4412 legacy
run_arm legacy-base "$O" "$R/ws-base" 4412 legacy
run_arm legacy-head-zh "$O" "$R/ws-head" 4412 legacy zh-CN
echo RUN_ARMS_DONE
