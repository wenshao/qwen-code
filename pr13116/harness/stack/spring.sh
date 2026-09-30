#!/bin/bash
# VERIFICATION RIG ONLY (PR 13116). usage: spring.sh <jar label> <db> [extra --key=value ...]
#   JFR records every thrown exception with its stack (the observed call paths).
S=/Users/wenshao/pr13116-rig/stack; RIG=/Users/wenshao/pr13116-rig; L=$1; DB=$2; shift 2
JAR=$RIG/jars/$L.jar; CLI=$RIG/wt-jar/dist/cli.js
mkdir -p $S/run/state-$DB $S/decoy
MOUNTS=""; i=0
for st in a b c d e f g h i j k l; do
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-13116 --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$S/roots/$st"
  mkdir -p $S/roots/$st/child; i=$((i+1))
done
export TZ=UTC RIG_LAUNCH_LOG=$S/run/launches-$DB.log
JFR=$S/run/spring-$L-$DB-$(date +%H%M%S).jfr; echo $JFR > $S/run/spring.jfr.path
exec /Users/wenshao/Install/jdk21/bin/java -Duser.timezone=UTC -XX:FlightRecorderOptions:stackdepth=96 \
  "-XX:StartFlightRecording=name=rig,filename=$JFR,dumponexit=true,maxsize=200m,jdk.JavaExceptionThrow#enabled=true,jdk.JavaExceptionThrow#stackTrace=true" \
  -Dloader.path=$S/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=18116 \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:23116/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig13116 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=http://127.0.0.1:18116 \
  --qwen.managed-agent.session-store.workspace-id=global-ws \
  --qwen.managed-agent.harness.enabled=true \
  --qwen.managed-agent.harness.workspace-files-enabled=true \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:16116 \
  --qwen.managed-agent.harness.token=rig-13116-token \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=19116 \
  --qwen.managed-agent.runtime-broker.token=rig-13116-token \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$S/decoy \
  --qwen.managed-agent.runtime-broker.state-directory=$S/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=<local-throwaway-key> \
  --qwen.managed-agent.runtime-broker.node-executable=$S/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$CLI \
  --qwen.managed-agent.runtime-broker.cli-entry=$CLI \
  $MOUNTS \
  "$@"
