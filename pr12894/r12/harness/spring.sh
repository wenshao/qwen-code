#!/bin/bash
# usage: spring.sh <db> <httpPort> <brokerPort> [extra args]
# env: STORAGES (letters), ROOTS, WT (worker/cli worktree), JAR_ARM, PUB (1=tool publication on),
#      PUB_* capacity overrides, BROKER_TOKEN
DB=$1; HTTP=$2; BPORT=$3; shift 3
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/01614b74-ad2d-46ba-bd62-6246811907b8/scratchpad/rig
S=$(dirname $R)
JAR=$S/jars/${JAR_ARM:-pr}-server.jar
WT=${WT:-$HOME/git/qwen-code-pr12894}
mkdir -p $R/run/state-$DB
MOUNTS=(); i=0
for st in ${STORAGES:-a b c d}; do
  MOUNTS+=(--qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-rig --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=${ROOTS:-$R/roots}/$st)
  mkdir -p ${ROOTS:-$R/roots}/$st/child; i=$((i+1))
done
PUBARGS=()
if [ "${PUB:-1}" = "1" ]; then
  PUBARGS=(--qwen.managed-agent.tool-publication.enabled=true
    --qwen.managed-agent.tool-publication.oss-endpoint=${OSS_ENDPOINT:-https://oss-cn-hangzhou.aliyuncs.com}
    --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou
    --qwen.managed-agent.tool-publication.oss-bucket=rig-bucket
    --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:${PUB_PORT:-$HTTP}/
    --qwen.managed-agent.tool-publication.execution-bytes=${PUB_EXEC:-2147483648}
    --qwen.managed-agent.tool-publication.session-bytes=${PUB_SESSION:-8589934592}
    --qwen.managed-agent.tool-publication.tenant-bytes=${PUB_TENANT:-17179869184}
    --qwen.managed-agent.tool-publication.active-captures=${PUB_ACTIVE:-16}
    --qwen.managed-agent.tool-publication.entry-concurrency=${PUB_ENTRY:-8}
    --qwen.managed-agent.tool-publication.operation-timeout=${PUB_OPTIMEOUT:-120s}
    --qwen.managed-agent.tool-publication.claim-timeout=${PUB_CLAIM:-30s})
fi
export RIG_LAUNCH_LOG=$R/run/launches-$DB.log
export OSS_ACCESS_KEY_ID=rig-ak OSS_ACCESS_KEY_SECRET=rig-sk
exec ~/Install/jdk21/bin/java ${JVM_EXTRA} -Dhttps.proxyHost= -Dhttp.proxyHost= -DsocksProxyHost= -Dhttp.nonProxyHosts=* ${JVM_POST} -Djdk.net.hosts.file=$R/tls/hosts \
  -Djavax.net.ssl.trustStore=$R/tls/trust.jks -Djavax.net.ssl.trustStorePassword=rigtrust \
  -Dloader.path=$R/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$HTTP \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:13894/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig12894 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BPORT \
  --qwen.managed-agent.runtime-broker.token=${BROKER_TOKEN:-rig-broker-token-12894} \
  --qwen.managed-agent.runtime-broker.workspace-cwd=${ROOTS:-$R/roots} \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$WT/dist/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$WT/dist/cli.js \
  "${MOUNTS[@]}" "${PUBARGS[@]}" \
  "$@"
