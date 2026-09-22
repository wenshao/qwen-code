#!/usr/bin/env bash
# usage: arm.sh <base|head> <tag> <port> <workspace>...   — swap client arm, (re)start daemon, wait for Live topology
R=/root/verify/pr12441; H=/root/verify/pr12441-head
ARM=$1; TAG=$2; PORT=$3; shift 3
for p in $(ss -ltnpH "sport = :$PORT" | command grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill -TERM -- -$p 2>/dev/null || kill -TERM $p; done
for i in $(seq 1 50); do ss -ltnH "sport = :$PORT" | command grep -q . || break; sleep 0.2; done
rm -f $H/dist/web-shell; ln -s $R/arms/ws-$ARM-vite $H/dist/web-shell
setsid nohup $R/rig/start-daemon.sh $TAG $PORT "$@" > /dev/null 2>&1 &
N=$#
for i in $(seq 1 150); do
  J=$(curl -s --noproxy '*' -H 'Authorization: Bearer pr12441-token' http://127.0.0.1:$PORT/capabilities 2>/dev/null)
  echo "$J" | jq -e --argjson n $((N+1)) '.workspaces|length==$n' >/dev/null 2>&1 && break; sleep 0.4
done
echo "$J" > $R/rig/caps-$TAG.json
IDX=$(curl -s --noproxy '*' http://127.0.0.1:$PORT/ | command grep -o 'assets/index-[^"]*\.js' | head -1)
echo "arm=$ARM tag=$TAG served=$IDX mws=$(echo "$J" | jq '.features|index("multi_workspace_sessions")!=null') ws=$(echo "$J" | jq -c '[.workspaces[]|{kind,primary,trusted}]')"
