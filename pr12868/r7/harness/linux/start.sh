#!/bin/sh
# Starts the Spring server with the embedded Runtime Broker inside the Linux container.
# usage: start.sh <db> <durable true|false>
DB=$1; DURABLE=$2
cd /rig
mkdir -p /rig/state/$DB && chmod 700 /rig/state /rig/state/$DB
: > /rig/spring.log
nohup java -Dloader.path=/rig/adapter.jar -cp /rig/server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=0.0.0.0 --server.port=18890 \
  "--spring.datasource.url=jdbc:mysql://pr12868-mysql:3306/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig12868 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.harness.capability-digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.host=0.0.0.0 \
  --qwen.managed-agent.runtime-broker.port=19890 \
  --qwen.managed-agent.runtime-broker.token=rig-broker-token-12868 \
  --qwen.managed-agent.runtime-broker.workspace-cwd=/rig/roots/plain \
  --qwen.managed-agent.runtime-broker.state-directory=/rig/state/$DB \
  --qwen.managed-agent.runtime-broker.durable-local-process=$DURABLE \
  --qwen.managed-agent.runtime-broker.credential-key-id=rig \
  --qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ= \
  --qwen.managed-agent.runtime-broker.node-executable=/usr/local/bin/node \
  --qwen.managed-agent.runtime-broker.worker-entry=/rig/wt/dist/cli.js \
  --qwen.managed-agent.runtime-broker.cli-entry=/rig/wt/dist/cli.js \
  "--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-rig" "--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a" "--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=/rig/roots/a" \
  "--qwen.managed-agent.runtime-broker.workspace-mounts[1].tenant-id=t-rig" "--qwen.managed-agent.runtime-broker.workspace-mounts[1].storage-id=st-b" "--qwen.managed-agent.runtime-broker.workspace-mounts[1].root=/rig/roots/b" \
  > /rig/spring.log 2>&1 &
echo $! > /rig/spring.pid
i=0
while [ $i -lt 120 ]; do
  if grep -q "Started .* in .* seconds" /rig/spring.log; then echo "started pid=$(cat /rig/spring.pid)"; exit 0; fi
  if ! kill -0 $(cat /rig/spring.pid) 2>/dev/null; then echo "spring died"; tail -30 /rig/spring.log; exit 1; fi
  i=$((i+1)); sleep 1
done
echo "timeout"; tail -30 /rig/spring.log; exit 1
