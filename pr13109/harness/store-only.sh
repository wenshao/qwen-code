#!/bin/bash
# store-only.sh <tree> <db-url> <run-dir> <port> <tag>  -- a store-only Spring (no Broker) from <tree>
# on the rig's database. PID in <run-dir>/store-<tag>.pid, log store-<tag>.log.
set -euo pipefail
TREE=$1; DB=$2; RUN=$3; PORT=$4; TAG=$5
S=$(cd "$(dirname "$0")/.." && pwd)
JAVA=/opt/homebrew/opt/openjdk@25/bin/java
SRV=$TREE/packages/sdk-java/managed-agent-server
mkdir -p "$RUN/root-store-$TAG"
nohup $JAVA -Duser.timezone=UTC -Drig.reuse=true -Drig.storeOnly=true -Drig.workspaces=0 \
  -Drig.root="$RUN/root-store-$TAG" -Drig.db="$DB" -Drig.node=/usr/bin/false -Drig.cli=/dev/null \
  -Drig.port=$PORT -Drig.brokerPort=$((PORT+1000)) -Drig.adminPort=$((PORT-1000)) \
  -cp "$S/rig/java/out:$SRV/target/classes:$(cat "$S/cp.txt")" RigMain > "$RUN/store-$TAG.log" 2>&1 &
echo $! > "$RUN/store-$TAG.pid"
for i in $(seq 1 120); do
  grep -q RIG_READY "$RUN/store-$TAG.log" && break
  if ! kill -0 "$(cat "$RUN/store-$TAG.pid")" 2>/dev/null; then echo "STORE_DIED"; tail -30 "$RUN/store-$TAG.log"; exit 1; fi
  sleep 1
done
grep RIG_READY "$RUN/store-$TAG.log"
