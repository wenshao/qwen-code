#!/bin/bash
# VERIFICATION RIG ONLY: start the real server fat jar (embedded Runtime Broker).  usage: spring.sh <jar-arm> <db> [extra spring args...]
# ROLE=store starts replica B on SPRING_B_PORT that only serves the Session Store (no Harness dispatch, no Broker);
# STORE=b points replica A's Harness at B's Session Store, so restarting A (cold attachment cache) keeps the Store up.
set -u
. /root/v13163/rig/rig.env
L=$1; DB=$2; shift 2
RUN=$RIG/run/$DB; mkdir -p $RUN/broker $RUN/decoy $RUN/ws; chmod 700 $RUN/broker
MOUNTS=""; i=0
for st in a b c d e f g h; do
  mkdir -p $RUN/ws/$st/child
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$(cd $RUN/ws/$st && pwd -P)"
  i=$((i+1))
done
PORT=$SPRING_PORT; PIDF=$RUN/spring.pid; PFX=spring
[ "${STORE:-a}" = b ] && STORE_URL=http://127.0.0.1:$SPRING_B_PORT || STORE_URL=http://127.0.0.1:$SPRING_PORT
if [ "${ROLE:-}" = store ]; then PORT=$SPRING_B_PORT; PIDF=$RUN/spring-b.pid; PFX=springb; STORE_URL=http://127.0.0.1:$SPRING_B_PORT; fi
N=$(ls $RUN/$PFX-*.log 2>/dev/null | wc -l); LOG=$RUN/$PFX-$N.log
echo "=== $(date -u +%FT%TZ) jar=$L db=$DB wsfiles=${WSFILES:-true} extra=$* ${SPRING_EXTRA:-}" > $LOG
setsid nohup env -i PATH=$JAVA_HOME/bin:/usr/bin:/bin TZ=UTC LANG=C HOME=$RUN/home QWEN_MANAGED_AGENT_APPROVAL_MODE=${APPROVAL:-yolo} \
  $JAVA_HOME/bin/java -Xmx2g -Duser.timezone=UTC -jar $RIG/server/$L-server.jar \
  --server.address=127.0.0.1 --server.port=$PORT \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.trusted-actor-header=X-Rig-Actor \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=$STORE_URL \
  --qwen.managed-agent.session-store.workspace-id=unused-global-workspace \
  --qwen.managed-agent.harness.enabled=$([ "${ROLE:-}" = store ] && echo false || echo true) \
  --qwen.managed-agent.harness.workspace-files-enabled=$([ "${ROLE:-}" = store ] && echo false || echo ${WSFILES:-true}) \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:${HARNESS_VIA:-$TAP_PORT} \
  --qwen.managed-agent.harness.token=$HTOKEN \
  --qwen.managed-agent.harness.request-timeout=120s \
  --qwen.managed-agent.harness.capability-digest=$DIGEST \
  --qwen.managed-agent.runtime-broker.enabled=$([ "${ROLE:-}" = store ] && echo false || echo true) \
  --qwen.managed-agent.runtime-broker.port=$BROKER_PORT \
  --qwen.managed-agent.runtime-broker.token=$BTOKEN \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$(cd $RUN/decoy && pwd -P) \
  --qwen.managed-agent.runtime-broker.state-directory=$RUN/broker \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=$CREDKEY \
  --qwen.managed-agent.runtime-broker.node-executable=$NODE \
  --qwen.managed-agent.runtime-broker.worker-entry=$RIG/dist/${DIST:-head}/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$RIG/dist/${DIST:-head}/cli.js \
  --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false \
  $MOUNTS "$@" ${SPRING_EXTRA:-} >> $LOG 2>&1 < /dev/null &
echo $! > $PIDF
for i in $(seq 1 150); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "$PFX pid=$(cat $PIDF) jar=$L store=$STORE_URL up after ${i}s log=$LOG"; exit 0; }
  kill -0 $(cat $PIDF) 2>/dev/null || { echo "$PFX DIED"; grep -E "ERROR|Exception|Caused" $LOG | head -20 | cut -c1-400; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
