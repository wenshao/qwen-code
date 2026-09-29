#!/bin/bash
# Bring up the PR #13071 stack: MySQL-backed Spring Session Store + embedded
# Runtime Broker on 18897/19897 against a fresh `d6a` database, broker workers
# run the PR worktree's dist/cli.js.
R=/root/rig13071
pkill -f "server.port=18897" 2>/dev/null; sleep 1
mkdir -p $R/roots/a/child
cd /root/rig && (
  STORAGES="a" ROOTS=$R/roots WT=${WT:-/root/git/qwen-code-pr13071} \
  JAR_ARM=pr BROKER_TOKEN=${BROKER_TOKEN:-rig-broker-token-12894} \
  nohup ./spring.sh d6a 18897 19897 > $R/run/spring-d6a.log 2>&1 &
)
for i in $(seq 1 120); do
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18897/actuator/health 2>/dev/null | grep -q 200 && break
  sleep 1
done
echo "spring: $(curl -s http://127.0.0.1:18897/actuator/health)"
