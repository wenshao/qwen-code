#!/bin/bash
# Stop one rig Spring by port (default 38094) and its worker children, by PID only.
PORT=${1:-38094}; SIG=${2:-TERM}
sp=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t)
[ -z "$sp" ] && exit 0
ps -o command= -p $sp | grep -q "server.port=$PORT" || { echo "$PORT is not a rig Spring"; exit 1; }
ps -o command= -p $sp | grep -q "9d84bca0" || { echo "$PORT Spring belongs to another rig"; exit 1; }
kids=$(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}')
kill -$SIG $sp $kids 2>/dev/null
for i in $(seq 1 30); do lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
