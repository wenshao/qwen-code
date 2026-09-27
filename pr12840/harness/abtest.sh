#!/bin/bash
# One V13 database with randomized legacy events (one long Session crossing
# V15 read pages), dumped and restored twice, migrated by the PR jar and by
# the candidate jar; identity columns compared.
SP=/path/to/scratchpad
B=$HOME/Install/mysql-8.4.7-macos15-arm64/bin
db() { $B/mysql --no-defaults -uroot -prig12840 -h127.0.0.1 -P33841 -N -B "$@" 2>/dev/null; }
PORT=33855; U=http://127.0.0.1:$PORT; T=rig-ab-$(date +%s)
wait_up() { for i in $(seq 1 300); do [ "$(curl -s -o /dev/null -w '%{http_code}' $U/actuator/health)" = 200 ] && return 0; kill -0 $PID 2>/dev/null || return 1; sleep 1; done; return 1; }
for d in p840_ab_src p840_ab_pr p840_ab_cand; do db -e "DROP DATABASE IF EXISTS $d"; done
$SP/rig/spring.sh $SP/jars/base-server.jar $PORT 33854 mysql://127.0.0.1:33841 p840_ab_src --qwen.managed-agent.harness.enabled=false > $SP/logs/ab-src.log 2>&1 & PID=$!
wait_up || { echo "base failed"; exit 1; }
IDS=""
for i in $(seq 1 40); do IDS="$IDS $(curl -s -X POST -H "X-Qwen-Tenant-Id: $T" -H 'content-type: application/json' -H "Idempotency-Key: ab-$i" $U/v1/agents/sessions -d '{"agent_id":"qwen-code","input":[]}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"; done
sleep 2; kill $PID; wait $PID 2>/dev/null
LONG=900 node $SP/rig/legacy-gen.mjs $T 777 $IDS > $SP/out/ab-legacy.sql 2> $SP/out/ab-legacy.stats
db p840_ab_src < $SP/out/ab-legacy.sql
echo "legacy: $(cat $SP/out/ab-legacy.stats); longest session: $(db p840_ab_src -e "SELECT MAX(c) FROM (SELECT COUNT(*) c FROM managed_agent_event GROUP BY session_id) x")"
$B/mysqldump --no-defaults -uroot -prig12840 -h127.0.0.1 -P33841 p840_ab_src > $SP/out/ab-src.dump 2>/dev/null
for arm in pr cand; do
  db -e "CREATE DATABASE p840_ab_$arm"; db p840_ab_$arm < $SP/out/ab-src.dump
  JAVA_TOOL_OPTIONS="-Xmx256m -XX:+ExitOnOutOfMemoryError" $SP/rig/spring.sh $SP/jars/$arm-server.jar $PORT 33854 mysql://127.0.0.1:33841 p840_ab_$arm --qwen.managed-agent.harness.enabled=false > $SP/logs/ab-$arm.log 2>&1 & PID=$!
  wait_up || { echo "$arm failed"; tail -3 $SP/logs/ab-$arm.log; }
  kill $PID; wait $PID 2>/dev/null
  echo "$arm: $(db p840_ab_$arm -e "SELECT CONCAT(type, ' ', execution_time, 'ms') FROM flyway_schema_history WHERE version = '15'") identities=$(db p840_ab_$arm -e "SELECT CONCAT(SUM(item_id IS NOT NULL), '/', SUM(content_part_id IS NOT NULL), '/', COUNT(*)) FROM managed_agent_event") md5=$(db p840_ab_$arm -e "SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', tenant_id, session_id, sequence_id, IFNULL(item_id,'-'), IFNULL(content_part_id,'-'), schema_version, projection_version) ORDER BY tenant_id, session_id, sequence_id SEPARATOR '\n')) FROM managed_agent_event" --group_concat_max_len=1073741824)"
done
