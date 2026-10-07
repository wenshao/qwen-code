#!/bin/bash
# VERIFICATION RIG ONLY: start the real server fat jar (embedded Runtime Broker) on the host.
# usage: spring.sh <jar-label> <db> <approval-mode|absent> <approval-timeout|absent> [extra spring args...]
set -u
. /Users/wenshao/pr13163-rig/rig.env
L=$1; DB=$2; MODE=$3; TMO=$4; shift 4
RUN=$RIG/run/$DB; mkdir -p $RUN/broker $RUN/decoy $RUN/ws
MOUNTS=""; i=0
for st in a b c d e f g h; do
  mkdir -p $RUN/ws/$st/child
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$(cd $RUN/ws/$st && pwd -P)"
  i=$((i+1))
done
[ "$MODE" != "absent" ] && export QWEN_MANAGED_AGENT_APPROVAL_MODE=$MODE
[ "$TMO" != "absent" ] && export QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT=$TMO
export TZ=UTC PATH=$JAVA_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin
N=$(ls $RUN/spring-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$RUN/spring-$N.log
echo "=== $(date -u +%FT%TZ) jar=$L db=$DB mode=$MODE timeout=$TMO wsfiles=${WSFILES:-true} extra=$*" > $LOG
nohup $JAVA_HOME/bin/java -Duser.timezone=UTC -Dloader.path=$RIG/adapter.jar -cp $RIG/server/$L-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$SPRING_PORT \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=${STORE_URL:-http://127.0.0.1:$SPRING_PORT} \
  --qwen.managed-agent.session-store.workspace-id=unused-global-workspace \
  --qwen.managed-agent.harness.enabled=true \
  --qwen.managed-agent.harness.workspace-files-enabled=${WSFILES:-true} \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:${HARNESS_VIA:-$TAP_PORT} \
  --qwen.managed-agent.harness.token=$HTOKEN \
  --qwen.managed-agent.harness.capability-digest=$DIGEST \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BROKER_PORT \
  --qwen.managed-agent.runtime-broker.token=$BTOKEN \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$(cd $RUN/decoy && pwd -P) \
  --qwen.managed-agent.runtime-broker.state-directory=$RUN/broker \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=$CREDKEY \
  --qwen.managed-agent.runtime-broker.node-executable=$NODE \
  --qwen.managed-agent.runtime-broker.worker-entry=$RIG/dist/${DIST:-head}/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$RIG/dist/${DIST:-head}/cli.js \
  $MOUNTS "$@" ${SPRING_EXTRA:-} >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
echo "spring pid=$(cat $RUN/spring.pid) log=$LOG"
for i in $(seq 1 120); do
  if curl -s -o /dev/null -m 2 http://127.0.0.1:$SPRING_PORT/actuator/health 2>/dev/null || grep -q "Started ManagedAgentServerApplication" $LOG; then grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring up after ${i}s"; exit 0; }; fi
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring DIED"; tail -30 $LOG | cut -c1-400; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
