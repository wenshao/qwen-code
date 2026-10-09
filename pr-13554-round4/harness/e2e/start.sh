#!/bin/bash
# usage: [GC=true] [GRACE=PT20S] [FAKETS=<file>] start.sh <arm> <name> <port> <db> [extra args...]
set -e
E=/Users/wenshao/pr13554-rig/e2e; D=$E/run; mkdir -p $D
ARM=$1; NAME=$2; PORT=$3; DB=$4; shift 4
mkdir -p $D/state-$NAME && chmod 700 $D/state-$NAME
# A wait loop must never read a previous run's log.
rm -f $D/$NAME.log
PRE=()
if [ -n "${FAKETS:-}" ]; then
  PRE=(env LD_PRELOAD=/usr/lib/aarch64-linux-gnu/faketime/libfaketimeMT.so.1 FAKETIME_DONT_FAKE_MONOTONIC=1 FAKETIME_TIMESTAMP_FILE=$FAKETS FAKETIME_CACHE_DURATION=1)
fi
nohup "${PRE[@]}" java -Xmx768m -cp $E/classes-$ARM:$E/app-$ARM/classes:$(cat $E/cp-$ARM.txt) \
  com.alibaba.qwen.code.managedagent.store.E2EBroker \
  --server.port=$PORT \
  --spring.datasource.url="jdbc:mysql://${DBHOST:-mysql84:3306}/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false&connectionAttributes=program_name:$NAME" \
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
for i in $(seq 1 180); do grep -qE "E2E-RIG (collector-owner|no stream-capture)|APPLICATION FAILED" $D/$NAME.log 2>/dev/null && break; sleep 1; done
grep -E "APPLICATION FAILED" $D/$NAME.log && echo "BOOT FAILED $NAME"
echo "booted $NAME after ${i}s"
