#!/bin/bash
# usage: spring.sh <db> <httpPort> <brokerPort> <proxyPort> [extra args]
# env: STORAGES (workspace mount letters), ROOTS, WORKER_ARM, JAR_ARM, BROKER_TOKEN
DB=$1; HTTP=$2; BPORT=$3; PROXY=$4; shift 4
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad/rig
JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad/jars/${JAR_ARM:-pr}-server.jar
mkdir -p $R/run/state-$DB
MOUNTS=""; i=0
for st in ${STORAGES:-a b}; do
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-rig --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=${ROOTS:-$R/roots}/$st"
  mkdir -p ${ROOTS:-$R/roots}/$st/child; i=$((i+1))
done
mkdir -p ${ROOTS:-$R/roots}/plain
export RIG_LAUNCH_LOG=$R/run/launches-$DB.log
PROXYARGS=""
if [ "$PROXY" != "0" ]; then PROXYARGS="-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=$PROXY -Dhttp.nonProxyHosts="; fi
exec /Users/wenshao/Install/jdk21/bin/java $PROXYARGS -Dloader.path=$R/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$HTTP \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:13868/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig12868 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BPORT \
  --qwen.managed-agent.runtime-broker.token=${BROKER_TOKEN:-rig-broker-token-12868} \
  --qwen.managed-agent.runtime-broker.workspace-cwd=${ROOTS:-$R/roots}/plain \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad/wt-${WORKER_ARM:-pr}/dist/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad/wt-${WORKER_ARM:-pr}/dist/cli.js \
  $MOUNTS \
  "$@"
