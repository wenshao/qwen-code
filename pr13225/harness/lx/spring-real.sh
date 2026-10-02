#!/bin/bash
# VERIFICATION RIG ONLY (PR #13225): spring.sh against REAL Aliyun OSS (temp bucket). Credentials come from
# /var/rig/oss.env (0600, container volume) and are exported to the JVM only. usage: OSS_BUCKET=.. spring-real.sh <jar> <db>
set -u
. /Users/wenshao/pr13225-rig/lx/env.sh
set -a; . /var/rig/oss.env; set +a
L=$1; DB=$2; shift 2
RUN=$VAR/run/$DB; mkdir -p $RUN/decoy $RUN/ws; LOGD=$RIG/run/lx-$DB; mkdir -p $LOGD
MOUNTS=""; i=0
for n in $(seq -w 1 40); do
  mkdir -p $RUN/ws/s$n/child
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-s$n --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$RUN/ws/s$n"
  i=$((i+1))
done
N=$(ls $LOGD/spring-*.log 2>/dev/null | wc -l | tr -d ' '); LOG=$LOGD/spring-$N.log
echo "=== $(date -u +%FT%TZ) jar=$L db=$DB REAL OSS gc=${GC:-} grace=${GRACE:-}" > $LOG
cd $RUN/decoy
nohup env TZ=UTC $JAVA -Duser.timezone=UTC -Dloader.path=$RIG/adapter.jar -cp $RIG/server/$L-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$SPRING_PORT \
  "--spring.datasource.url=jdbc:mysql://$DBHOST:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=$DBPASS \
  --qwen.managed-agent.session-store.enabled=true --qwen.managed-agent.session-store.base-url=http://127.0.0.1:$SPRING_PORT \
  --qwen.managed-agent.session-store.workspace-id=unused-global-workspace \
  --qwen.managed-agent.harness.enabled=true --qwen.managed-agent.harness.workspace-files-enabled=true \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:$TAP_PORT --qwen.managed-agent.harness.token=$HTOKEN \
  --qwen.managed-agent.harness.capability-digest=$DIGEST \
  --qwen.managed-agent.runtime-broker.enabled=true --qwen.managed-agent.runtime-broker.port=$BROKER_PORT \
  --qwen.managed-agent.runtime-broker.token=$BTOKEN --qwen.managed-agent.runtime-broker.workspace-cwd=$RUN/decoy \
  --qwen.managed-agent.runtime-broker.state-directory=$RUN/broker --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=$CREDKEY --qwen.managed-agent.runtime-broker.node-executable=$NODE \
  --qwen.managed-agent.runtime-broker.worker-entry=$RIG/dist/merge34/cli.js --qwen.managed-agent.runtime-broker.cli-entry=$RIG/dist/merge34/cli.js \
  --qwen.managed-agent.runtime-broker.durable-local-process=true \
  --qwen.managed-agent.tool-publication.enabled=true \
  --qwen.managed-agent.tool-publication.oss-endpoint=https://oss-cn-hangzhou.aliyuncs.com \
  --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou \
  --qwen.managed-agent.tool-publication.oss-bucket=$OSS_BUCKET \
  --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:$SPRING_PORT/ \
  --qwen.managed-agent.tool-publication.execution-bytes=2147483648 --qwen.managed-agent.tool-publication.session-bytes=8589934592 \
  --qwen.managed-agent.tool-publication.tenant-bytes=68719476736 --qwen.managed-agent.tool-publication.active-captures=16 \
  --qwen.managed-agent.tool-publication.entry-concurrency=8 --qwen.managed-agent.tool-publication.operation-timeout=300s \
  --qwen.managed-agent.tool-publication.claim-timeout=30s --qwen.managed-agent.tool-publication.verification-bytes-per-second=20971520 \
  --qwen.managed-agent.tool-publication.max-verification-timeout=10m \
  --qwen.managed-agent.artifacts.enabled=true --qwen.managed-agent.artifacts.publish-original=true --qwen.managed-agent.artifacts.publish-preview=true \
  --qwen.managed-agent.tool-publication.gc-enabled=${GC:-false} --qwen.managed-agent.tool-publication.deletion-grace=${GRACE:-24h} \
  $MOUNTS "$@" >> $LOG 2>&1 &
echo $! > $RUN/spring.pid
for i in $(seq 1 240); do
  grep -q "Started ManagedAgentServerApplication" $LOG && { echo "spring pid=$(cat $RUN/spring.pid) up after ${i}s (real OSS)"; exit 0; }
  kill -0 $(cat $RUN/spring.pid) 2>/dev/null || { echo "spring DIED"; grep -E "Exception|Caused by" $LOG | head -5 | cut -c1-240; exit 1; }
  sleep 1
done
echo "spring start TIMEOUT"; exit 1
