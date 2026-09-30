#!/bin/bash
# VERIFICATION RIG ONLY (PR #13117): start the real server fat jar (embedded Runtime Broker) on the host.
# usage: spring.sh <jar-label> <db>
set -u
. /Users/wenshao/pr13117-rig/rig.env
L=$1; DB=$2
RUN=$RIG/run/$DB; mkdir -p $RUN/broker $RUN/decoy $RUN/ws/a/child
export TZ=UTC PATH=$JAVA_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin
LOG=$RUN/spring.log
echo "=== $(date -u +%FT%TZ) jar=$L db=$DB" > $LOG
nohup $JAVA_HOME/bin/java -Duser.timezone=UTC -Dloader.path=$RIG/adapter.jar -cp $RIG/server/$L-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$SPRING_PORT \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=http://127.0.0.1:$SPRING_PORT \
  --qwen.managed-agent.session-store.workspace-id=unused-global-workspace \
  --qwen.managed-agent.harness.enabled=true \
  --qwen.managed-agent.harness.workspace-files-enabled=true \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:$HARNESS_PORT \
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
  --qwen.managed-agent.runtime-broker.worker-entry=$CLI \
  --qwen.managed-agent.runtime-broker.cli-entry=$CLI \
  --qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=$TENANT \
  --qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a \
  --qwen.managed-agent.runtime-broker.workspace-mounts[0].root=$(cd $RUN/ws/a && pwd -P) \
  >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
for i in $(seq 1 180); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring $L up after ${i}s pid=$(cat $RUN/spring.pid)"; exit 0; }
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring DIED"; tail -30 $LOG | cut -c1-400; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; tail -20 $LOG | cut -c1-300; exit 1
