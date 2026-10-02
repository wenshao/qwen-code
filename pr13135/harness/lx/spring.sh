#!/bin/bash
# VERIFICATION RIG ONLY: Spring fat jar inside the Linux container, durable local-process Broker.
# usage: spring.sh <jar-label> <db> [extra spring args...]   env: MODE (approval mode), DIST (worker dist), STATE (broker state dir name, default broker)
set -u
. /Users/wenshao/pr13135-rig/lx/env.sh
L=$1; DB=$2; shift 2
RUN=$VAR/run/$DB; mkdir -p $RUN/decoy $RUN/ws; LOGD=$RIG/run/lx-$DB; mkdir -p $LOGD
STATE=$RUN/${STATE:-broker}
MOUNTS=""; i=0
for st in a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  mkdir -p $RUN/ws/$st/child
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$RUN/ws/$st"
  i=$((i+1))
done
[ -n "${MODE:-}" ] && export QWEN_MANAGED_AGENT_APPROVAL_MODE=$MODE
N=$(ls $LOGD/spring-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$LOGD/spring-$N.log
echo "=== $(date -u +%FT%TZ) jar=$L db=$DB mode=${MODE:-} dist=${DIST:-head} state=$STATE extra=$*" > $LOG
cd $RUN/decoy
nohup env TZ=UTC $JAVA -Duser.timezone=UTC -Dloader.path=$RIG/adapter.jar -cp $RIG/server/$L-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=0.0.0.0 --server.port=$SPRING_PORT \
  "--spring.datasource.url=jdbc:mysql://$DBHOST:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=http://127.0.0.1:$SPRING_PORT \
  --qwen.managed-agent.session-store.workspace-id=unused-global-workspace \
  --qwen.managed-agent.harness.enabled=true \
  --qwen.managed-agent.harness.workspace-files-enabled=true \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:${HARNESS_VIA:-$TAP_PORT} \
  --qwen.managed-agent.harness.token=$HTOKEN \
  --qwen.managed-agent.harness.capability-digest=$DIGEST \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BROKER_PORT \
  --qwen.managed-agent.runtime-broker.token=$BTOKEN \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$RUN/decoy \
  --qwen.managed-agent.runtime-broker.state-directory=$STATE \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=$CREDKEY \
  --qwen.managed-agent.runtime-broker.node-executable=$NODE \
  --qwen.managed-agent.runtime-broker.worker-entry=$RIG/dist/${DIST:-head}/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$RIG/dist/${DIST:-head}/cli.js \
  --qwen.managed-agent.runtime-broker.durable-local-process=${DURABLE:-true} \
  $MOUNTS "$@" >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
for i in $(seq 1 180); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring pid=$(cat $RUN/spring.pid) up after ${i}s log=$LOG"; exit 0; }
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring DIED"; grep -E "Exception|Caused by|ERROR" $LOG | head -8 | cut -c1-300; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
