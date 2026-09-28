#!/bin/bash
# usage: spring.sh <jarArm> <db> [extra args]
#   env: CLI_ARM (wt-<arm>/dist/cli.js, default pr), FILES (true/false), STORAGES, TENANT
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
R=$SP/rig; ARM=$1; DB=$2; shift 2
JAR=$SP/jars/$ARM-server.jar; CLI=$SP/wt-${CLI_ARM:-pr}/dist/cli.js
mkdir -p $R/run/state-$DB
MOUNTS=""; i=0
for st in ${STORAGES-a b c d e f g h i j k l}; do
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=${TENANT:-t-g0} --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$R/roots/$st"
  mkdir -p $R/roots/$st/child; i=$((i+1))
done
export TZ=UTC RIG_LAUNCH_LOG=$R/run/launches-$DB.log
exec ~/Install/jdk21/bin/java -Duser.timezone=UTC -Dloader.path=$R/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=18955 \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:23955/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig12955 \
  --qwen.managed-agent.session-store.enabled=${STORE:-true} \
  --qwen.managed-agent.session-store.base-url=http://127.0.0.1:18955 \
  --qwen.managed-agent.session-store.workspace-id=global-ws \
  --qwen.managed-agent.harness.enabled=${HARNESS:-true} \
  --qwen.managed-agent.harness.workspace-files-enabled=${FILES:-true} \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:16955 \
  --qwen.managed-agent.harness.token=rig-g0-token \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=${BROKER:-true} \
  --qwen.managed-agent.runtime-broker.port=19955 \
  --qwen.managed-agent.runtime-broker.token=rig-g0-token \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$R/decoy \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$CLI \
  --qwen.managed-agent.runtime-broker.cli-entry=$CLI \
  $MOUNTS \
  "$@"
