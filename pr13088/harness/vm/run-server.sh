#!/bin/bash
# PR #13088 verification rig: the real server fat jar (embedded Runtime Broker) as a systemd service.
set -u
. /etc/qwen-w1a.env
LOG=/var/log/qwen-w1a/server.log
echo "=== $(date -u +%FT%T.%3NZ) start pid=$$ boot_id=$(cat /proc/sys/kernel/random/boot_id) machine_id=$(cat /etc/machine-id) jar=$JAR dist=$DIST verified=$VERIFIED durable=$DURABLE harness=$HARNESS db=$DB" >> $LOG
MOUNTS=""; i=0
for st in $STORAGES; do
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-w1a --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=${ROOTBASE:-/srv/w1a}/$st"
  i=$((i+1))
done
VER=""; [ "$VERIFIED" != "absent" ] && VER="--qwen.managed-agent.runtime-broker.verified-workspace-recovery-enabled=$VERIFIED"
HARN="--qwen.managed-agent.harness.enabled=false"
[ "$HARNESS" = "true" ] && HARN="--qwen.managed-agent.harness.enabled=true --qwen.managed-agent.harness.workspace-files-enabled=true --qwen.managed-agent.harness.base-url=http://127.0.0.1:17088 --qwen.managed-agent.harness.token=rig-w1a-harness-token --qwen.managed-agent.session-store.base-url=http://127.0.0.1:8088 --qwen.managed-agent.session-store.workspace-id=global-ws"
export PATH=/opt/w1a/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec /opt/qwen/jdk/bin/java -Duser.timezone=UTC -Dloader.path=/opt/w1a/adapter.jar${LOADER_EXTRA:+,$LOADER_EXTRA} -cp /opt/w1a/$JAR org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=8088 \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:${DBPORT:-3306}/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=${DBPASS:-rootpw} \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  $HARN \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=4188 \
  --qwen.managed-agent.runtime-broker.token=rig-w1a-broker-token \
  --qwen.managed-agent.runtime-broker.workspace-cwd=/srv/w1a-decoy \
  --qwen.managed-agent.runtime-broker.state-directory=/var/lib/qwen-w1a/$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=<rig-credential-key> \
  --qwen.managed-agent.runtime-broker.node-executable=/opt/qwen/node \
  --qwen.managed-agent.runtime-broker.worker-entry=/opt/w1a/$DIST/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=/opt/w1a/$DIST/cli.js \
  --qwen.managed-agent.runtime-broker.durable-local-process=$DURABLE \
  --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=${TRUSTED:-false} \
  $VER $MOUNTS ${EXTRA:-} >> $LOG 2>&1
