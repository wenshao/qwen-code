#!/bin/bash
# respring.sh <tree> <db-url> <run-dir>  -- stop Spring and start it again from <tree>
# on the SAME database and run directory (MCP servers and ledger are kept).
set -euo pipefail
TREE=$1; DB=$2; RUN=$3
S=$(cd "$(dirname "$0")/.." && pwd)
JAVA=/opt/homebrew/opt/openjdk@25/bin/java
OLD=$(cat "$RUN/spring.pid")
kill "$OLD"; for i in $(seq 1 60); do kill -0 "$OLD" 2>/dev/null || break; sleep 1; done
kill -0 "$OLD" 2>/dev/null && { echo STILL_ALIVE; exit 1; }
mv "$RUN/spring.log" "$RUN/spring-before-restart.log"
SRV=$TREE/packages/sdk-java/managed-agent-server
QWEN_MANAGED_MCP_CONFIG=$RUN/manifest.json nohup $JAVA -Duser.timezone=UTC -Drig.reuse=true \
  -Drig.workspaces=${RIG_WS:-12} -Drig.root="$RUN/root" -Drig.db="$DB" -Drig.node="$RUN/node-wrap.sh" -Drig.cli="${RIG_CLI:-$TREE/dist/cli.js}" \
  -Drig.port=${RIG_PORT:-18946} -Drig.brokerPort=${RIG_BROKER_PORT:-19946} -Drig.adminPort=${RIG_ADMIN_PORT:-17946} \
  -cp "$S/rig/java/out:$SRV/target/classes:$(cat "${RIG_CP:-$S/cp.txt}")" RigMain > "$RUN/spring.log" 2>&1 &
echo $! > "$RUN/spring.pid"
for i in $(seq 1 120); do
  grep -q RIG_READY "$RUN/spring.log" && break
  if ! kill -0 "$(cat "$RUN/spring.pid")" 2>/dev/null; then echo "SPRING_DIED"; tail -30 "$RUN/spring.log"; exit 1; fi
  sleep 1
done
grep RIG_READY "$RUN/spring.log"
