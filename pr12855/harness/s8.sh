#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad; cd $SP/rig
NODE=~/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
for arm in pr j4; do
  port=$([ $arm = pr ] && echo 18857 || echo 18858)
  (JVM_OPTS=-Duser.timezone=UTC nohup ./spring.sh tenant_$arm $port $arm > logs/spring-tenant-$arm.log 2>&1 &)
  for i in $(seq 1 120); do c=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Qwen-Tenant-Id: t1' http://127.0.0.1:$port/v1/agents/sessions); [ "$c" = 200 ] && break; sleep 1; done
  ARM=$arm PORT=$port $NODE s8-tenant.mjs 2>&1 | cut -c1-700
  P=$(pgrep -f "server.port=$port"); kill $P; while kill -0 $P 2>/dev/null; do sleep 0.5; done
done
