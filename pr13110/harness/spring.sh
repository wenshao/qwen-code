#!/bin/bash
# VERIFICATION RIG ONLY: start the real server fat jar (Session Store + embedded Runtime Broker + local-process workers) on the host.
# The Hosted Harness is driven directly by the probes, so the server's own Harness connector is disabled (same as HostedWorkspaceToolTurnIT).
# usage: spring.sh <jar-label> <db> [extra spring args...]      env: WORKER_DIST (dist label for the worker, default head), STORAGES, SPRING_PORT/BROKER_PORT overrides
set -u
. /rig/rig.env
L=$1; DB=$2; shift 2
SPRING_PORT=${SPORT:-$SPRING_PORT}; BROKER_PORT=${BPORT:-$BROKER_PORT}
RUN=$RIG/run/$DB; mkdir -p $RUN/broker $RUN/decoy $RUN/ws $RUN/worker-home/.qwen
MOUNTS=""; i=0
ALL=$(echo {a..z} {a..z}2 {a..z}3)
for st in ${STORAGES:-$ALL}; do
  mkdir -p $RUN/ws/$st/child
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$(cd $RUN/ws/$st && pwd -P)"
  i=$((i+1))
done
N=$(ls $RUN/spring-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$RUN/spring-$N.log
echo "=== $(date -u +%FT%TZ) jar=$L db=$DB worker=${WORKER_DIST:-head} extra=$*" > $LOG
# The Broker starts workers with its own environment, so the worker's file-history backups land under this QWEN_HOME.
nohup env -i PATH="$JAVA_HOME/bin:$(dirname $NODE):/usr/bin:/bin:/usr/sbin:/sbin" TZ=UTC HOME=$RUN/worker-home QWEN_HOME=$RUN/worker-home/.qwen \
  $JAVA_HOME/bin/java -Duser.timezone=UTC -Dloader.path=$RIG/adapter/adapter.jar -cp $RIG/server/$L-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$SPRING_PORT \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=$DIGEST \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BROKER_PORT \
  --qwen.managed-agent.runtime-broker.token=$BTOKEN \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$(cd $RUN/decoy && pwd -P) \
  --qwen.managed-agent.runtime-broker.state-directory=$RUN/broker \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  --qwen.managed-agent.runtime-broker.node-executable=$NODE \
  --qwen.managed-agent.runtime-broker.worker-entry=$RIG/dist/${WORKER_DIST:-head}/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$RIG/dist/${WORKER_DIST:-head}/cli.js \
  $MOUNTS "$@" >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
for i in $(seq 1 240); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring pid=$(cat $RUN/spring.pid) up after ${i}s log=$LOG"; exit 0; }
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring DIED"; tail -30 $LOG | cut -c1-400; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
