#!/bin/bash
# usage: start.sh <pr|base> <name> <port> <db> [extra args...]
set -e
mkdir -p /root/verify/pr13554/e2e/run/state-$2 && chmod 700 /root/verify/pr13554/e2e/run/state-$2
ARM=$1; NAME=$2; PORT=$3; DB=$4; shift 4
E=/root/verify/pr13554/e2e; D=$E/run; mkdir -p $D
nohup /usr/local/jdk21/bin/java -Xmx768m -cp $E/classes-$ARM:$E/app-$ARM/classes:$(cat $E/cp-wt-$ARM.txt) \
  com.alibaba.qwen.code.managedagent.store.E2EBroker \
  --server.port=$PORT \
  --spring.datasource.url="jdbc:mysql://127.0.0.1:33554/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false&connectionAttributes=program_name:$NAME" \
  --spring.datasource.username=root --spring.datasource.password=verify \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.tool-publication.enabled=true \
  --qwen.managed-agent.tool-publication.gc-enabled=${GC:-true} \
  --qwen.managed-agent.tool-publication.deletion-grace=${GRACE:-PT20S} \
  --qwen.managed-agent.tool-publication.oss-endpoint=https://oss-cn-hangzhou.aliyuncs.com \
  --qwen.managed-agent.tool-publication.oss-region=cn-hangzhou \
  --qwen.managed-agent.tool-publication.oss-bucket=verify-not-used \
  --qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:$PORT \
  --qwen.managed-agent.tool-publication.execution-bytes=67108864 \
  --qwen.managed-agent.tool-publication.session-bytes=268435456 \
  --qwen.managed-agent.tool-publication.tenant-bytes=1073741824 \
  --qwen.managed-agent.tool-publication.active-captures=16 \
  --qwen.managed-agent.tool-publication.entry-concurrency=4 \
  --qwen.managed-agent.tool-publication.operation-timeout=PT2M \
  --qwen.managed-agent.tool-publication.claim-timeout=PT1M \
  --qwen.managed-agent.tool-publication.verification-bytes-per-second=1048576 \
  --qwen.managed-agent.tool-publication.max-verification-timeout=PT5M \
  --qwen.managed-agent.runtime-broker.enabled=true \
  --qwen.managed-agent.runtime-broker.port=$((PORT+1000)) \
  --qwen.managed-agent.runtime-broker.token=e2e-broker-token-0123456789abcdef \
  --qwen.managed-agent.runtime-broker.credential-key-id=e2e \
  --qwen.managed-agent.runtime-broker.credential-key=$(cat $E/broker.key) \
  --qwen.managed-agent.runtime-broker.state-directory=$D/state-$NAME \
  --qwen.managed-agent.runtime-broker.workspace-cwd=$E/ws \
  --qwen.managed-agent.runtime-broker.node-executable=/usr/bin/node \
  --qwen.managed-agent.runtime-broker.worker-entry=$E/stub/worker.js \
  --qwen.managed-agent.runtime-broker.cli-entry=$E/stub/cli.js \
  --qwen.managed-agent.harness.capability-digest=$(cat $E/digest.txt) \
  "$@" > $D/$NAME.log 2>&1 &
echo $! > $D/$NAME.pid
echo "started $NAME arm=$ARM pid=$(cat $D/$NAME.pid) port=$PORT db=$DB"
