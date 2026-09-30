#!/bin/bash
# Bring up the PR #13098 stack: MySQL-backed Spring Session Store + embedded
# Runtime Broker on 18898/19898 against a fresh `d6a98` database, broker
# workers run the PR worktree's dist/cli.js.
R=/root/rig13098
pkill -f "server.port=18898" 2>/dev/null; sleep 1
mkdir -p $R/roots/a/child $R/run
cd /root/rig && (
  STORAGES="a" ROOTS=$R/roots WT=${WT:-/root/git/qwen-code-pr13098} \
  JAR_ARM=pr BROKER_TOKEN=${BROKER_TOKEN:-rig-broker-token-12894} \
  nohup ./spring.sh d6a98 18898 19898 > $R/run/spring-d6a98.log 2>&1 &
)
for i in $(seq 1 120); do
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18898/actuator/health 2>/dev/null | grep -q 200 && break
  sleep 1
done
echo "spring: $(curl -s http://127.0.0.1:18898/actuator/health)"
