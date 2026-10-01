#!/bin/bash
# PR #13087 rig. usage: spring.sh <db> <httpPort> <brokerPort> [extra spring args]
# env: JAR_ARM, WT (worker/harness worktree), STORAGES, ROOTS, GC (true/false/none), GRACE (e.g. 10s; none = omit),
#      LOCKWAIT (innodb_lock_wait_timeout for this Spring's connections), PUB_PORT (publication ingress port)
DB=$1; HTTP=$2; BPORT=$3; shift 3
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e527af64-439d-460f-9801-f450f5aae9a4/scratchpad/rig
JAR=$R/jars/${JAR_ARM:-head-abad13c7}-server.jar
WT=${WT:-$HOME/git/qwen-code-pr13087}
mkdir -p $R/run/state-$DB-$HTTP
MOUNTS=(); i=0
for st in ${STORAGES:-$(seq -f 's%02g' 1 60)}; do
  MOUNTS+=(--qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-rig --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=${ROOTS:-$R/roots}/$st)
  mkdir -p ${ROOTS:-$R/roots}/$st/child; i=$((i+1))
done
GCARGS=()
[ "${GC:-true}" != "none" ] && GCARGS+=(--qwen.managed-agent.tool-publication.gc-enabled=${GC:-true})
[ "${GRACE:-10s}" != "none" ] && GCARGS+=(--qwen.managed-agent.tool-publication.deletion-grace=${GRACE:-10s})
SV=""; [ -n "$LOCKWAIT" ] && SV="&sessionVariables=innodb_lock_wait_timeout=$LOCKWAIT"
HF="-Djdk.net.hosts.file=${HOSTS_FILE:-$R/tls/hosts}"; [ "$HOSTS_FILE" = "none" ] && HF="-Dqwen.rig.hosts=system"
TS="-Djavax.net.ssl.trustStore=$R/tls/trust.jks -Djavax.net.ssl.trustStorePassword=rigtrust"; [ "$HOSTS_FILE" = "none" ] && TS="-Dqwen.rig.trust=system"
export RIG_LAUNCH_LOG=$R/run/launches-$DB.log
export OSS_ACCESS_KEY_ID=${OSS_ACCESS_KEY_ID:-rig-ak} OSS_ACCESS_KEY_SECRET=${OSS_ACCESS_KEY_SECRET:-rig-sk}
exec ~/Install/jdk21/bin/java ${JVM_EXTRA} -Dhttps.proxyHost= -Dhttp.proxyHost= -DsocksProxyHost= -Dhttp.nonProxyHosts=* $HF \
  $TS \
  -Dloader.path=$R/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$HTTP \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:${DBPORT:-13894}/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false$SV" \
  --spring.datasource.username=root --spring.datasource.password=rig12894 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$BPORT \
  --qwen.managed-agent.runtime-broker.token=${BROKER_TOKEN:-hosted-tools-broker-token} \
  --qwen.managed-agent.runtime-broker.workspace-cwd=${ROOTS:-$R/roots} \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB-$HTTP \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$WT/dist/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$WT/dist/cli.js \
  --qwen.managed-agent.tool-publication.enabled=true \
  --qwen.managed-agent.tool-publication.oss-endpoint=${OSS_ENDPOINT:-https://oss-cn-hangzhou.aliyuncs.com:28443} \
  --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou \
  --qwen.managed-agent.tool-publication.oss-bucket=${OSS_BUCKET:-rig-bucket} \
  --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:${PUB_PORT:-$HTTP}/ \
  --qwen.managed-agent.tool-publication.execution-bytes=${PUB_EXEC:-2147483648} \
  --qwen.managed-agent.tool-publication.session-bytes=${PUB_SESSION:-8589934592} \
  --qwen.managed-agent.tool-publication.tenant-bytes=${PUB_TENANT:-17179869184} \
  --qwen.managed-agent.tool-publication.active-captures=${PUB_ACTIVE:-16} \
  --qwen.managed-agent.tool-publication.entry-concurrency=${PUB_ENTRY:-8} \
  --qwen.managed-agent.tool-publication.operation-timeout=${PUB_OPTIMEOUT:-120s} \
  --qwen.managed-agent.tool-publication.claim-timeout=${PUB_CLAIM:-30s} \
  --qwen.managed-agent.tool-publication.verification-bytes-per-second=16777216 \
  --qwen.managed-agent.tool-publication.max-verification-timeout=25m \
  "${MOUNTS[@]}" "${GCARGS[@]}" \
  "$@"
