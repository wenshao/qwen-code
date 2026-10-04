#!/bin/bash
# VERIFICATION RIG ONLY: start the real server fat jar (embedded Runtime Broker) for one arm.
# usage: spring.sh <arm> [extra spring args...]     env: JAR=<label> (default arm), DIST=<label> (default arm)
set -u
. /Users/wenshao/pr13351-rig/rig.env; . $RIG/ports.sh $1; ARM=$1; shift
JL=${JAR:-$ARM}; DL=${DIST:-$ARM}
RUN=$RIG/run/$ARM; mkdir -p $RUN/broker $RUN/decoy $RUN/ws
MOUNTS=""; i=0
for st in a b c; do
  mkdir -p $RUN/ws/$st/child
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$(cd $RUN/ws/$st && pwd -P)"
  i=$((i+1))
done
export TZ=UTC PATH=$JAVA_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin QWEN_MANAGED_AGENT_APPROVAL_MODE=${APPROVAL:-yolo}
N=$(ls $RUN/spring-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$RUN/spring-$N.log
echo "=== $(date -u +%FT%TZ) arm=$ARM jar=$JL dist=$DL extra=$*" > $LOG
nohup $JAVA_HOME/bin/java -Duser.timezone=UTC -Dloader.path=$RIG/adapter.jar -cp $RIG/server/$JL-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$SPRING_PORT \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
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
  --qwen.managed-agent.runtime-broker.workspace-cwd=$(cd $RUN/decoy && pwd -P) \
  --qwen.managed-agent.runtime-broker.state-directory=$RUN/broker \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=$CREDKEY \
  --qwen.managed-agent.runtime-broker.node-executable=$NODE \
  --qwen.managed-agent.runtime-broker.worker-entry=$RIG/dist/$DL/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$RIG/dist/$DL/cli.js \
  --qwen.managed-agent.runtime-broker.durable-local-process=false \
  --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false \
  $MOUNTS "$@" >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
echo "spring[$ARM] pid=$(cat $RUN/spring.pid) jar=$JL log=$LOG"
for i in $(seq 1 240); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring[$ARM] up after ${i}s"; exit 0; }
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring[$ARM] DIED"; tail -30 $LOG | cut -c1-400; exit 1; }
  sleep 1
done
echo "spring[$ARM] start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
