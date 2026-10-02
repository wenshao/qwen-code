#!/bin/bash
# VERIFICATION RIG ONLY (PR #13166): Spring server jar = Session Store + embedded Runtime Broker (+ local workers).
# Harness integration off: probes drive the packaged Harness /session route directly with a toolProfile.
# usage: spring.sh <db> [worker-dist-label] [jar-label]
set -u
. /Users/wenshao/pr13166-rig/rig.env
DB=$1; WD=${2:-head}; JL=${3:-head}
RUN=$RIG/run/$DB; mkdir -p $RUN/broker $RUN/roots $RUN/workers
MOUNTS=""; i=0
for st in ${STORAGES:-a b c d e f g h i j k l}; do
  mkdir -p $RUN/roots/$st
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$(cd $RUN/roots/$st && pwd -P)"
  i=$((i+1))
done
export TZ=UTC PATH=$JAVA_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin RIG_WORKER_LOGS=$RUN/workers
N=$(ls $RUN/spring-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$RUN/spring-$N.log
echo "=== $(date -u +%FT%TZ) db=$DB worker=$WD jar=$JL" > $LOG
nohup $JAVA_HOME/bin/java -Duser.timezone=UTC -Dloader.path=$RIG/adapter.jar -cp $RIG/server/$JL-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$SPRING_PORT \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=$DIGEST \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BROKER_PORT \
  --qwen.managed-agent.runtime-broker.token=$BTOKEN \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$(cd $RUN/roots && pwd -P) \
  --qwen.managed-agent.runtime-broker.state-directory=$RUN/broker \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=$CREDKEY \
  --qwen.managed-agent.runtime-broker.node-executable=$RIG/node-wrap.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$RIG/dist/$WD/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$RIG/dist/$WD/cli.js \
  $MOUNTS >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
for i in $(seq 1 180); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring pid=$(cat $RUN/spring.pid) up after ${i}s log=$LOG"; exit 0; }
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring DIED"; tail -30 $LOG | cut -c1-400; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
