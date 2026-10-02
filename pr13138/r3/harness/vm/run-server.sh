#!/bin/bash
# PR #13138 verification rig: the real server fat jar (embedded Runtime Broker) as a systemd service.
set -u
. /etc/qwen-w1b.env
LOG=/var/log/qwen-w1b/server.log
echo "=== $(date -u +%FT%T.%3NZ) start pid=$$ boot_id=$(cat /proc/sys/kernel/random/boot_id) machine_id=$(cat /etc/machine-id) jar=$JAR dist=$DIST verified=$VERIFIED durable=$DURABLE harness=$HARNESS db=$DB" >> $LOG
MOUNTS=""; i=0
for st in $STORAGES; do
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-w1b --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=${ROOTBASE:-/srv/w1b}/$st"
  i=$((i+1))
done
VER=""; [ "$VERIFIED" != "absent" ] && VER="--qwen.managed-agent.runtime-broker.verified-workspace-recovery-enabled=$VERIFIED"
HARN="--qwen.managed-agent.harness.enabled=false"
[ "$HARNESS" = "true" ] && HARN="--qwen.managed-agent.harness.enabled=true --qwen.managed-agent.harness.workspace-files-enabled=true --qwen.managed-agent.harness.base-url=http://127.0.0.1:17188 --qwen.managed-agent.harness.token=rig-w1b-harness-token --qwen.managed-agent.session-store.base-url=http://127.0.0.1:8188 --qwen.managed-agent.session-store.workspace-id=global-ws"
# O2 remote Shell publication against the local OSS double (TLS on :443, names resolved by the JVM hosts file).
PUBARGS=""; PUBJVM=""
if [ "${PUB:-0}" = "1" ]; then
  PUBARGS="--qwen.managed-agent.tool-publication.enabled=true --qwen.managed-agent.tool-publication.oss-endpoint=https://oss-cn-hangzhou.aliyuncs.com --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou --qwen.managed-agent.tool-publication.oss-bucket=rig-bucket --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:8188/ --qwen.managed-agent.tool-publication.execution-bytes=2147483648 --qwen.managed-agent.tool-publication.session-bytes=8589934592 --qwen.managed-agent.tool-publication.tenant-bytes=17179869184 --qwen.managed-agent.tool-publication.active-captures=16 --qwen.managed-agent.tool-publication.entry-concurrency=8 --qwen.managed-agent.tool-publication.operation-timeout=120s --qwen.managed-agent.tool-publication.claim-timeout=30s --qwen.managed-agent.tool-publication.verification-bytes-per-second=4194304 --qwen.managed-agent.tool-publication.max-verification-timeout=1200s"
  PUBJVM="-Djdk.net.hosts.file=/opt/w1b/o2/tls/hosts -Djavax.net.ssl.trustStore=/opt/w1b/o2/tls/trust.jks -Djavax.net.ssl.trustStorePassword=rigtrust"
  export OSS_ACCESS_KEY_ID=rig-ak OSS_ACCESS_KEY_SECRET=rig-sk
fi
# PUB=real: the same O2 publication against a real Aliyun OSS bucket. Credentials and bucket live in a root-only file
# outside the rig directory (never published); no hosts file or private trust store.
if [ "${PUB:-0}" = "real" ]; then
  . /var/lib/qwen-w1b/oss-real.env
  export OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET
  PUBARGS="--qwen.managed-agent.tool-publication.enabled=true --qwen.managed-agent.tool-publication.oss-endpoint=https://oss-cn-hangzhou.aliyuncs.com --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou --qwen.managed-agent.tool-publication.oss-bucket=$OSS_BUCKET --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:8188/ --qwen.managed-agent.tool-publication.execution-bytes=2147483648 --qwen.managed-agent.tool-publication.session-bytes=8589934592 --qwen.managed-agent.tool-publication.tenant-bytes=17179869184 --qwen.managed-agent.tool-publication.active-captures=16 --qwen.managed-agent.tool-publication.entry-concurrency=8 --qwen.managed-agent.tool-publication.operation-timeout=120s --qwen.managed-agent.tool-publication.claim-timeout=30s --qwen.managed-agent.tool-publication.verification-bytes-per-second=4194304 --qwen.managed-agent.tool-publication.max-verification-timeout=1200s"
  PUBJVM=""
fi
# Hosted MCP (H1): the runtime worker inherits this and loads the server manifest.
[ "${MCP:-0}" = "1" ] && export QWEN_MANAGED_MCP_CONFIG=/var/lib/qwen-w1b/mcp-manifest.json
# Hosted Hooks (H2, merged from main for round 3): workers load the deployment Hook manifest.
[ "${HOOKS:-0}" = "1" ] && export QWEN_MANAGED_HOOK_CONFIG=/var/lib/qwen-w1b/hooks.json RIG_HOOK_LEDGER=/var/lib/qwen-w1b/hook-ledger.jsonl
# Worker file-history volume per scenario database (workers inherit this environment).
export QWEN_HOME=/var/lib/qwen-w1b/home-$DB
mkdir -p $QWEN_HOME
export PATH=/opt/w1b/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec /opt/qwen/jdk/bin/java -Duser.timezone=UTC $PUBJVM -Dloader.path=/opt/w1b/adapter.jar${LOADER_EXTRA:+,$LOADER_EXTRA} -cp /opt/w1b/$JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=8188 \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:${DBPORT:-3306}/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=${DBPASS:-rootpw} \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  $HARN \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=4288 \
  --qwen.managed-agent.runtime-broker.token=rig-w1b-broker-token \
  --qwen.managed-agent.runtime-broker.workspace-cwd=/srv/w1b-decoy \
  --qwen.managed-agent.runtime-broker.state-directory=/var/lib/qwen-w1b/$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=/opt/qwen/node \
  --qwen.managed-agent.runtime-broker.worker-entry=/opt/w1b/$DIST/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=/opt/w1b/$DIST/cli.js \
  --qwen.managed-agent.runtime-broker.durable-local-process=$DURABLE \
  --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=${TRUSTED:-false} \
  $VER $MOUNTS $PUBARGS ${EXTRA:-} >> $LOG 2>&1
