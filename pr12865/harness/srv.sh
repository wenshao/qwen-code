#!/bin/bash
# usage: srv.sh <n> <durable:true|false> [db]
N=$1; DURABLE=$2; DB=${3:-qwen_managed_agent}
export SPRING_DATASOURCE_URL="jdbc:mysql://pr12865-db:3306/$DB"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=rootpw
export QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=sha256:<random 64 hex>
export QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED=true
export QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN=broker-secret-pr12865
export QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID=local-dev-v1
export QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY=<random base64 32 bytes>
export QWEN_MANAGED_AGENT_WORKSPACE_CWD=/work/ws
export QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY=/var/lib/qwen-rt/$DB
export QWEN_MANAGED_AGENT_NODE_EXECUTABLE=/usr/local/bin/node
export QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY=/opt/qwen/dist/cli.js
export QWEN_MANAGED_AGENT_CLI_ENTRY=/opt/qwen/dist/cli.js
export QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS=$DURABLE
mkdir -p /work/ws /var/lib/qwen-rt && chmod 700 /var/lib/qwen-rt
cd /tmp && nohup java -Duser.timezone=UTC -jar /rig/server/qwen-managed-agent-server-0.1.0-alpha.jar > /rig/out/srv-$N.log 2>&1 &
echo $! > /tmp/srv.pid; echo "server $N pid=$! durable=$DURABLE db=$DB"
