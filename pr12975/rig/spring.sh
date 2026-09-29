#!/bin/bash
# usage: spring.sh <db> <httpPort> <brokerPort> [extra args]   (JAR_ARM=main|merge)
DB=$1; HTTP=$2; BPORT=$3; shift 3
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/rig
JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/jars/${JAR_ARM:-merge}-server.jar
mkdir -p $R/run/state-$DB
MOUNTS=""; i=0
for st in ${STORAGES:-a b}; do
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-rig --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=${ROOTS:-$R/roots}/$st"
  mkdir -p ${ROOTS:-$R/roots}/$st/child; i=$((i+1))
done
export RIG_LAUNCH_LOG=$R/run/launches-$DB.log
exec ~/Install/jdk21/bin/java -Duser.timezone=UTC $JAVA_EXTRA -Dloader.path=$R/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$HTTP \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:13975/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password= \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BPORT \
  --qwen.managed-agent.runtime-broker.token=${BROKER_TOKEN:-rig-broker-token-12975} \
  --qwen.managed-agent.runtime-broker.workspace-cwd=${ROOTS:-$R/roots} \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=<rig-local-key> \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/wt-merge/dist/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/wt-merge/dist/cli.js \
  $MOUNTS \
  "$@"
