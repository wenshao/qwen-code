#!/bin/bash
# VERIFICATION RIG ONLY (PR #13037)
# usage: spring.sh <jarArm> <db> [extra spring args]
#   env: CLI_WT (worktree with dist/cli.js), ARTIFACTS / PUB_ORIGINAL / PUB_PREVIEW (true|false; unset = property omitted),
#        PUB (1 = O2 tool publication on), HARNESS (true|false), MAX_READS, READ_TIMEOUT, JVM_EXTRA, OSS_MODE (fake|real)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/19f717cd-fa69-4495-b803-21c540ab1bd6/scratchpad; R=$S/rig; ARM=$1; DB=$2; shift 2
JAR=$S/jars/$ARM-server.jar; CLI=${CLI_WT:-/Users/wenshao/git/qwen-code-pr13037}/dist/cli.js
mkdir -p $R/run/state-$DB
MOUNTS=(); i=0
for n in $(seq -w 1 ${NSTORAGES:-90}); do
  MOUNTS+=(--qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-o3 --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-s$n --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$R/roots/s$n)
  mkdir -p $R/roots/s$n/child; i=$((i+1))
done
PUBARGS=()
if [ "${PUB:-1}" = "1" ]; then
  PUBARGS=(--qwen.managed-agent.tool-publication.enabled=true
    --qwen.managed-agent.tool-publication.oss-endpoint=https://oss-cn-hangzhou.aliyuncs.com
    --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou
    --qwen.managed-agent.tool-publication.oss-bucket=${OSS_BUCKET:-rig-bucket}
    --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:18037/
    --qwen.managed-agent.tool-publication.execution-bytes=2147483648
    --qwen.managed-agent.tool-publication.session-bytes=8589934592
    --qwen.managed-agent.tool-publication.tenant-bytes=68719476736
    --qwen.managed-agent.tool-publication.active-captures=16
    --qwen.managed-agent.tool-publication.entry-concurrency=8
    --qwen.managed-agent.tool-publication.operation-timeout=300s
    --qwen.managed-agent.tool-publication.claim-timeout=30s
    --qwen.managed-agent.tool-publication.verification-bytes-per-second=${PUB_VERIFY_BPS:-20971520}
    --qwen.managed-agent.tool-publication.max-verification-timeout=${PUB_VERIFY_MAX:-10m})
fi
ARTARGS=()
[ -n "${ARTIFACTS:-}" ] && ARTARGS+=(--qwen.managed-agent.artifacts.enabled=$ARTIFACTS)
[ -n "${PUB_ORIGINAL:-}" ] && ARTARGS+=(--qwen.managed-agent.artifacts.publish-original=$PUB_ORIGINAL)
[ -n "${PUB_PREVIEW:-}" ] && ARTARGS+=(--qwen.managed-agent.artifacts.publish-preview=$PUB_PREVIEW)
[ -n "${MAX_READS:-}" ] && ARTARGS+=(--qwen.managed-agent.artifacts.max-concurrent-reads=$MAX_READS)
[ -n "${READ_TIMEOUT:-}" ] && ARTARGS+=(--qwen.managed-agent.artifacts.read-timeout=$READ_TIMEOUT)
export TZ=UTC RIG_LAUNCH_LOG=$R/run/launches-$DB.log
OSSJVM=(-Djdk.net.hosts.file=$R/tls/hosts -Djavax.net.ssl.trustStore=$R/tls/trust.jks -Djavax.net.ssl.trustStorePassword=rigtrust)
if [ "${OSS_MODE:-fake}" = "fake" ]; then export OSS_ACCESS_KEY_ID=rig-ak OSS_ACCESS_KEY_SECRET=rig-sk; else
  # real Aliyun OSS: credentials are read from the maintainer's file and exported to the JVM only; never printed
  OSSJVM=(); export OSS_ACCESS_KEY_ID="$(awk '$1=="accessKeyId"{print $2}' $HOME/Aliyun/README.md)" OSS_ACCESS_KEY_SECRET="$(awk '$1=="accessKeySecret"{print $2}' $HOME/Aliyun/README.md)"
fi
exec ~/Install/jdk21/bin/java -Duser.timezone=UTC ${JVM_EXTRA} -Dhttps.proxyHost= -Dhttp.proxyHost= -DsocksProxyHost= "-Dhttp.nonProxyHosts=*" "${OSSJVM[@]}" \
  -Dloader.path=$R/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=18037 \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:${DB_PORT:-23037}/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig13037 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.session-store.base-url=http://127.0.0.1:18037 \
  --qwen.managed-agent.session-store.workspace-id=global-ws \
  --qwen.managed-agent.harness.enabled=${HARNESS:-true} \
  --qwen.managed-agent.harness.workspace-files-enabled=true \
  --qwen.managed-agent.harness.base-url=http://127.0.0.1:16037 \
  --qwen.managed-agent.harness.token=rig-o3-token \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=19037 \
  --qwen.managed-agent.runtime-broker.token=rig-o3-token \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$R/decoy \
  --qwen.managed-agent.runtime-broker.state-directory=$R/run/state-$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=$R/node22.sh \
  --qwen.managed-agent.runtime-broker.worker-entry=$CLI \
  --qwen.managed-agent.runtime-broker.cli-entry=$CLI \
  "${MOUNTS[@]}" "${PUBARGS[@]}" "${ARTARGS[@]}" \
  "$@"
