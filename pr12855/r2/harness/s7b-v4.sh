#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad; cd $SP/rig
NODE=~/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
up() { (JVM_OPTS=-Duser.timezone=UTC nohup ./spring.sh upg 18856 $1 > logs/spring-upg-$2.log 2>&1 &); for i in $(seq 1 120); do c=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Qwen-Tenant-Id: t1' http://127.0.0.1:18856/v1/agents/sessions); [ "$c" = 200 ] && echo "[$1 up after ${i}s]" && return; sleep 1; done; echo "[$1 did not start]"; }
down() { P=$(pgrep -f "server.port=18856"); [ -n "$P" ] && kill $P; while [ -n "$P" ] && kill -0 $P 2>/dev/null; do sleep 0.5; done; }
up main2 4; WT=$SP/wt-v4m RIG_OUT=$SP/rig/out PHASE=main-stageh $NODE s7-upgrade.mjs 2>&1 | cut -c1-900; down
up v4m 5; WT=$SP/wt-v4m RIG_OUT=$SP/rig/out PHASE=pr-again $NODE s7-upgrade.mjs 2>&1 | cut -c1-1200; down
