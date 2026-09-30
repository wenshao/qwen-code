#!/bin/bash
# VERIFICATION RIG ONLY. usage: spring.sh <db> [extra args]
#   JFR records every thrown exception with its stack (the observed call paths).
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad; R=$SP/rig; DB=$1; shift
JAR=$SP/jars/merge2-server.jar; CLI=$SP/wt-merge/dist/cli.js
mkdir -p $R/run/state-$DB
MOUNTS=""; i=0
for st in a b c d e f g h i j k l; do
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-13099 --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$R/roots/$st"
  mkdir -p $R/roots/$st/child; i=$((i+1))
done
export TZ=UTC RIG_LAUNCH_LOG=$R/run/launches-$DB.log
JFR=$R/run/spring-$DB-$(date +%H%M%S).jfr; echo $JFR > $R/run/spring.jfr.path
exec ~/Install/jdk21/bin/java -Duser.timezone=UTC -XX:FlightRecorderOptions:stackdepth=96 \
  "-XX:StartFlightRecording=name=rig,filename=$JFR,dumponexit=true,maxsize=200m,jdk.JavaExceptionThrow#enabled=true,jdk.JavaExceptionThrow#stackTrace=true" \
  -Dloader.path=$R/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=18099 \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:23099/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig13099 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=http://127.0.0.1:18099 \
  --qwen.managed-agent.session-store.workspace-id=global-ws \
  --qwen.managed-agent.harness.enabled=true \
  --qwen.managed-agent.harness.workspace-files-enabled=true \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:16099 \
  --qwen.managed-agent.harness.token=rig-13099-token \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=19099 \
  --qwen.managed-agent.runtime-broker.token=rig-13099-token \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$R/decoy \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$CLI \
  --qwen.managed-agent.runtime-broker.cli-entry=$CLI \
  $MOUNTS \
  "$@"
