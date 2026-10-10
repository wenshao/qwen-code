#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): Spring fat jar inside the Linux container, durable local-process Broker, loopback only.
# usage: spring.sh <jar-arm> <db> [extra spring args...]   env: DIST (worker dist arm, default = jar arm), STATE, HARNESS_VIA
set -u
. /Users/wenshao/pr13673-rig/lx/env.sh
L=$1; DB=$2; shift 2
RUN=$VAR/run/$DB; mkdir -p $RUN/decoy $RUN/ws; LOGD=$RIG/run/$DB; mkdir -p $LOGD
STATE=$RUN/${STATE:-broker}
MOUNTS=""; i=0
for st in a b c d e f; do
  mkdir -p $RUN/ws/$st/child
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$RUN/ws/$st"
  i=$((i+1))
done
N=$(ls $LOGD/spring-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$LOGD/spring-$N.log
echo "=== $(date -u +%FT%TZ) jar=$L db=$DB dbhost=$DBHOST tz=${RIGTZ:-UTC} dist=${DIST:-$L} state=$STATE extra=$*" > $LOG
mkdir -p $CGROOT
cd $RUN/decoy
nohup env TZ=${RIGTZ:-UTC} ${HOOKS:+QWEN_MANAGED_HOOK_CONFIG=$HOOKS} QWEN_MANAGED_HOOK_CGROUP_ROOT=$CGROOT ${MODE:+QWEN_MANAGED_AGENT_APPROVAL_MODE=$MODE} $JAVA ${JAVA_OPTS:-} -Duser.timezone=${RIGTZ:-UTC} -jar $RIG/server/$L-server.jar \
  --server.address=127.0.0.1 --server.port=$SPRING_PORT \
  --qwen.managed-agent.trusted-actor-header=X-Rig-Actor \
  "--spring.datasource.url=jdbc:mysql://$DBHOST:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=http://127.0.0.1:${STORE_VIA:-$STORE_TAP_PORT} \
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
  --qwen.managed-agent.runtime-broker.worker-entry=$DISTROOT/${DIST:-$L}/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$DISTROOT/${DIST:-$L}/cli.js \
  --qwen.managed-agent.runtime-broker.durable-local-process=${DURABLE:-true} \
  $MOUNTS "$@" >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
for i in $(seq 1 240); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring pid=$(cat $RUN/spring.pid) up after ${i}s log=$LOG"; exit 0; }
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring DIED"; grep -E "Exception|Caused by|ERROR" $LOG | head -8 | cut -c1-300; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
