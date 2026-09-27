#!/bin/bash
# PR #12869 verification rig: the real server jar with the embedded Runtime Broker.
set -u
. /etc/qwen-w0e3.env
BOOT=$(cat /proc/sys/kernel/random/boot_id)
LOG=/var/log/qwen-w0e3/server.log
echo "=== $(date -u +%FT%T.%3NZ) start pid=$$ boot_id=$BOOT machine_id=$(cat /etc/machine-id) durable=$DURABLE trusted=$TRUSTED tz=${JVM_TZ:-default}" >> $LOG
MOUNTS=""; i=0
for st in $STORAGES; do
  mkdir -p /srv/ws/$st/project
  MOUNTS="$MOUNTS --qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=t-rig --qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$st --qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=/srv/ws/$st"
  i=$((i+1))
done
TZARG=""; [ -n "${JVM_TZ:-}" ] && TZARG="-Duser.timezone=$JVM_TZ"
export PATH=/opt/qwen/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec /opt/qwen/jdk/bin/java $TZARG -Dloader.path=/opt/qwen/adapter.jar -cp /opt/qwen/${JAR:-server.jar} org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=8080 \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:3306/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rootpw \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=4182 \
  --qwen.managed-agent.runtime-broker.token=rig-broker-token-12869 \
  --qwen.managed-agent.runtime-broker.workspace-cwd=/srv/ws \
  --qwen.managed-agent.runtime-broker.state-directory=/var/lib/qwen-rt/$DB \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=<base64 of 32 random bytes, generated for the rig> \
  --qwen.managed-agent.runtime-broker.node-executable=/opt/qwen/bin/node-wrap \
  --qwen.managed-agent.runtime-broker.worker-entry=/opt/qwen/dist/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=/opt/qwen/dist/cli.js \
  --qwen.managed-agent.runtime-broker.durable-local-process=$DURABLE \
  --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=$TRUSTED \
  $MOUNTS ${EXTRA:-} >> $LOG 2>&1
