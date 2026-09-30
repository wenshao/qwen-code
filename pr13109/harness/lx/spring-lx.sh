#!/bin/bash
# spring-lx.sh <arm-classes> <cli-arm> <db> <run-dir> <reuse:true|false>
# Start Spring (store + embedded Broker, durable local workers) inside the container.
set -euo pipefail
CLS=$1; CLI=$2; DB=$3; RUN=$4; REUSE=$5
mkdir -p "$RUN"; mkdir -p -m 700 "$RUN/state"
[ -f "$RUN/spring.log" ] && mv "$RUN/spring.log" "$RUN/spring-$(date +%s).log"
QWEN_MANAGED_MCP_CONFIG=$RUN/manifest.json nohup java -Duser.timezone=UTC -Drig.reuse=$REUSE -Drig.durable=true \
  -Drig.stateDir="$RUN/state" -Drig.workspaces=6 -Drig.root="$RUN/root" \
  -Drig.db="jdbc:mysql://127.0.0.1:3306/$DB?useSSL=false&allowPublicKeyRetrieval=true" \
  -Drig.node="$RUN/node-wrap.sh" -Drig.cli="/rig/$CLI/dist/cli.js" \
  -cp "/rig/rigmain:/rig/classes-$CLS:/rig/lib/*" RigMain > "$RUN/spring.log" 2>&1 &
echo $! > "$RUN/spring.pid"
for i in $(seq 1 180); do
  grep -q RIG_READY "$RUN/spring.log" && break
  if ! kill -0 "$(cat "$RUN/spring.pid")" 2>/dev/null; then echo SPRING_DIED; tail -40 "$RUN/spring.log"; exit 1; fi
  sleep 1
done
grep -o 'RIG_READY.\{0,60\}' "$RUN/spring.log" | tail -1
