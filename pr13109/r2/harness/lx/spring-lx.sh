#!/bin/bash
# spring-lx.sh <arm-classes> <cli-arm> <db> <run-dir> <reuse:true|false>
# Start Spring (store + embedded Broker, durable local workers) inside the container.
set -euo pipefail
CLS=$1; CLI=$2; DB=$3; RUN=$4; REUSE=$5
mkdir -p "$RUN"; mkdir -p -m 700 "${RIG_STATE:-$RUN/state}"
TAG=${RIG_TAG:-spring}
[ -f "$RUN/$TAG.log" ] && mv "$RUN/$TAG.log" "$RUN/$TAG-$(date +%s).log"
QWEN_MANAGED_MCP_CONFIG=$RUN/manifest.json nohup java -Duser.timezone=UTC -Drig.reuse=$REUSE -Drig.durable=true \
  -Drig.stateDir="${RIG_STATE:-$RUN/state}" -Drig.root="${RIG_ROOT:-$RUN/root}" \
  -Drig.db="jdbc:mysql://${RIG_DBHOST:-127.0.0.1}:${RIG_DBPORT:-3306}/$DB?useSSL=false&allowPublicKeyRetrieval=true" -Drig.bind=${RIG_BIND:-127.0.0.1} -Drig.publicHost=${RIG_PUBLIC:-127.0.0.1} -Drig.port=${RIG_PORT:-18946} -Drig.brokerPort=${RIG_BROKER_PORT:-19946} -Drig.adminPort=${RIG_ADMIN_PORT:-17946} -Drig.workspaces=${RIG_WS:-6} \
  -Drig.node="$RUN/node-wrap.sh" -Drig.cli="/rig/$CLI/dist/cli.js" \
  -cp "/rig/rigmain:/rig/classes-$CLS:/rig/lib/*" RigMain > "$RUN/$TAG.log" 2>&1 &
echo $! > "$RUN/$TAG.pid"
for i in $(seq 1 180); do
  grep -q RIG_READY "$RUN/$TAG.log" && break
  if ! kill -0 "$(cat "$RUN/$TAG.pid")" 2>/dev/null; then echo SPRING_DIED; tail -40 "$RUN/$TAG.log"; exit 1; fi
  sleep 1
done
grep -o 'RIG_READY.\{0,60\}' "$RUN/$TAG.log" | tail -1
