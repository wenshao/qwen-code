#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b5c403f1-14a1-452a-91d4-be31986042f6/scratchpad
ARM=$1; FROZEN=$2; PORT=18194; OUT=$S/results/dst/$ARM-$FROZEN; mkdir -p $OUT
TZ=America/New_York \
SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33192/e2e_dst?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=pr13192pw QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true \
  $HOME/Install/jdk21/bin/java -jar $S/jars/server-$ARM.jar --server.port=$PORT \
  "--spring.datasource.hikari.connection-init-sql=SET timestamp = $FROZEN" > $OUT/server.log 2>&1 &
PID=$!
for i in $(seq 1 120); do curl -s -m 2 http://127.0.0.1:$PORT/actuator/health | grep -q UP && break; kill -0 $PID 2>/dev/null || break; sleep 1; done
node $S/tsprobe/dst-probe.mjs http://127.0.0.1:$PORT $ARM pr13192-mysql e2e_dst $FROZEN $OUT/dst.json
kill $PID; wait $PID 2>/dev/null; kill -0 $PID 2>/dev/null && echo "STILL ALIVE" || echo "stopped $PID"
