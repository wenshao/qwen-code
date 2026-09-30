#!/bin/bash
# Stop the rig Spring by PID and start it again with the same jar/worktree/db (env JAR, WT, DB).
R=$(cd $(dirname $0); pwd)
sp=$(lsof -nP -iTCP:18894 -sTCP:LISTEN -t)
if [ -n "$sp" ]; then
  ps -o command= -p $sp | grep -q "server.port=18894" || { echo "18894 is not the rig Spring"; exit 1; }
  tp=$(ps -ax -o pid=,command= | awk '/[E]xTap 15894/{print $1}')
  kill $sp $tp $(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}') 2>/dev/null
  for i in $(seq 1 30); do lsof -nP -iTCP:18894 -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
fi
DB=$DB ROOTS=$R/roots-r15 BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up14.sh $JAR $WT 2>&1 | tail -1
