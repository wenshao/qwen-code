#!/bin/bash
# R2-2: Harness enabled + Session Store disabled (Workspace files and Broker off) — does Spring start?
cd /Users/wenshao/git/pr13530-rig
for arm in main head; do
  if [ $arm = main ]; then JAR=arm-main/server.jar; P=18560; else JAR=/Users/wenshao/git/pr13530-head/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar; P=18561; fi
  DB=r22$arm; ./mysql.sh sql -e "CREATE DATABASE IF NOT EXISTS $DB"
  LOG=runs/r22-$arm.log; : > $LOG
  env -i PATH=/usr/bin:/bin HOME=/tmp TZ=UTC SERVER_PORT=$P \
    SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33530/$DB?useSSL=false&allowPublicKeyRetrieval=true" SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD= \
    QWEN_MANAGED_AGENT_HARNESS_ENABLED=true QWEN_MANAGED_AGENT_HARNESS_BASE_URL=http://127.0.0.1:9 QWEN_MANAGED_AGENT_HARNESS_TOKEN=rigtoken123456789 \
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=sha256:$(printf '%064d' 0) QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=false \
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED=false QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED=false \
    /Users/wenshao/Install/jdk21/bin/java -jar $JAR > $LOG 2>&1 &
  PID=$!
  st=TIMEOUT
  for i in $(seq 90); do
    if ! kill -0 $PID 2>/dev/null; then st="EXITED"; break; fi
    curl -s -o /dev/null -w '%{http_code}' --noproxy '*' http://127.0.0.1:$P/actuator/health 2>/dev/null | grep -q 200 && { st="STARTED(${i}s)"; break; }
    sleep 1
  done
  kill $PID 2>/dev/null; wait $PID 2>/dev/null
  echo "$arm: $st :: $(grep -oE 'Hosted Harness requires the Managed Session Store|IllegalStateException: [^"]{0,140}' $LOG | head -1)"
done
