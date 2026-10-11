#!/bin/bash
# usage: spring.sh <db> [extra args]   (Spring 18654, Broker 19654, publication ingress via fault proxy 18655)
# env: JAR_ARM (jars/<arm>-server.jar), WT (worker/cli worktree), ASYNC (1=async admission), JHA (1=journal-head auth),
#      VCONC (verification concurrency), STORAGES, PUB_* overrides, JVM_EXTRA
DB=$1; shift
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad/rig
JAR=$R/jars/${JAR_ARM:-head}-server.jar
WT=${WT:-$HOME/git/qwen-code-pr13654}
mkdir -p $R/run/state-$DB
MOUNTS=(); i=0
for st in ${STORAGES:-$(seq -f 's%02g' 1 60)}; do
  MOUNTS+=(--qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-rig --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=${ROOTS:-$R/roots}/$st)
  mkdir -p ${ROOTS:-$R/roots}/$st/child; i=$((i+1))
done
PUBARGS=(--qwen.managed-agent.tool-publication.enabled=true
  --qwen.managed-agent.tool-publication.oss-endpoint=https://oss-cn-hangzhou.aliyuncs.com
  --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou
  --qwen.managed-agent.tool-publication.oss-bucket=rig-bucket
  --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:${PUB_PORT:-18655}/
  --qwen.managed-agent.tool-publication.execution-bytes=${PUB_EXEC:-2147483648}
  --qwen.managed-agent.tool-publication.session-bytes=${PUB_SESSION:-8589934592}
  --qwen.managed-agent.tool-publication.tenant-bytes=${PUB_TENANT:-34359738368}
  --qwen.managed-agent.tool-publication.active-captures=${PUB_ACTIVE:-16}
  --qwen.managed-agent.tool-publication.entry-concurrency=${PUB_ENTRY:-8}
  --qwen.managed-agent.tool-publication.operation-timeout=${PUB_OPTIMEOUT:-120s}
  --qwen.managed-agent.tool-publication.claim-timeout=${PUB_CLAIM:-30s}
  --qwen.managed-agent.tool-publication.verification-bytes-per-second=${PUB_VBPS:-16777216}
  --qwen.managed-agent.tool-publication.max-verification-timeout=${PUB_VMAX:-25m}
  --qwen.managed-agent.tool-publication.journal-head-authorization=$( [ "${JHA:-1}" = 1 ] && echo true || echo false))
[ -n "${ASYNC:-}" ] && PUBARGS+=(--qwen.managed-agent.tool-publication.async-verification-enabled=$( [ "$ASYNC" = 1 ] && echo true || echo false))
[ -n "${VCONC:-}" ] && PUBARGS+=(--qwen.managed-agent.tool-publication.verification-concurrency=$VCONC)
export RIG_LAUNCH_LOG=$R/run/launches-$DB.log
export OSS_ACCESS_KEY_ID=rig-ak OSS_ACCESS_KEY_SECRET=rig-sk
exec $HOME/Install/jdk21/bin/java ${JVM_EXTRA} -Dhttps.proxyHost= -Dhttp.proxyHost= -DsocksProxyHost= -Dhttp.nonProxyHosts=* -Djdk.net.hosts.file=$R/tls/hosts \
  -Djavax.net.ssl.trustStore=$R/tls/trust.jks -Djavax.net.ssl.trustStorePassword=rigtrust \
  -jar $JAR \
  --server.address=127.0.0.1 --server.port=${HTTP_PORT:-18654} \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:13654/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig13654 \
  --qwen.managed-agent.trusted-actor-header=X-Rig-Actor \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=${BROKER_PORT:-19654} \
  --qwen.managed-agent.runtime-broker.durable-local-process=${DURABLE:-false} --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=${DURABLE:-false} \
  --qwen.managed-agent.runtime-broker.token=rig-broker-token-12894 \
  --qwen.managed-agent.runtime-broker.workspace-cwd=${ROOTS:-$R/roots} \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$WT/dist/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$WT/dist/cli.js \
  "${MOUNTS[@]}" "${PUBARGS[@]}" \
  "$@"
