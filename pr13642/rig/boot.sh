#!/bin/bash
# usage: boot.sh <jar> <db: mysql|maria> <dbname> <logname> [KEY=VAL ...]  (prints PID; waits for start or death)
S=$SCRATCH
JAR=$1; DB=$2; DBN=$3; LOG=$S/rig/logs/$4.log; shift 4
if [ "$DB" = mysql ]; then PORT=33642; else PORT=43642; fi
export JAVA_HOME=/Users/wenshao/Install/jdk21
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:$PORT/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=pr13642
export QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT=${BROKER_PORT:-18643}
export QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN=pr13642-broker-token-0123456789abcdef
export QWEN_MANAGED_AGENT_RUNTIME_PROVISIONER=static QWEN_MANAGED_AGENT_RUNTIME_ISOLATION=workspace
export QWEN_MANAGED_AGENT_STATIC_RUNTIME_ENDPOINT=http://127.0.0.1:18649/ QWEN_MANAGED_AGENT_STATIC_RUNTIME_TOKEN=pr13642-static-token
export QWEN_MANAGED_AGENT_WORKSPACE_CWD=$S/rig/ws QWEN_MANAGED_AGENT_WORKSPACE_ID=ws-pr13642
export QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY=false QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS=false
export QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID=k1 QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
for kv in "$@"; do export "$kv"; done
nohup $JAVA_HOME/bin/java -jar $JAR --server.port=${SERVER_PORT:-18642} > $LOG 2>&1 < /dev/null &
PID=$!; echo $PID > $LOG.pid
for i in $(seq 1 120); do
  if grep -q "Started ManagedAgentServerApplication" $LOG; then echo "STARTED pid=$PID"; exit 0; fi
  if ! kill -0 $PID 2>/dev/null; then echo "DIED pid=$PID"; exit 1; fi
  sleep 1
done
echo "TIMEOUT pid=$PID"; exit 2
