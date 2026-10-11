#!/bin/bash
# Unit-less / explicit max-age on a real jar through the shipped application.yml and env binding.
# usage: probe6a.sh <mysql|maria> <dbname> <tag> <jar> <value>...
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; DBN=$2; T=$3; JAR=$4; shift 4; P=QWEN_MANAGED_AGENT_RUNTIME
export SERVER_PORT=18662 BROKER_PORT=18663
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
echo "## [$T] jar=$(basename $JAR) sha=$(shasum -a 256 $JAR | cut -c1-12)"
$S/rig/boot.sh $JAR $DB $DBN $T-migrate ${P}_BROKER_ENABLED=true > /dev/null
grep -o 'Successfully applied [0-9]* migrations.*now at version v[0-9]*' $S/rig/logs/$T-migrate.log; stop $T-migrate
i=0
for V in "$@"; do
  i=$((i+1)); L=$S/rig/logs/$T-$i.log
  $S/rig/seed.sh $DB $DBN mini $i 2>/dev/null > /dev/null
  R=$($S/rig/boot.sh $JAR $DB $DBN $T-$i ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true "${P}_RETENTION_MAX_AGE=$V" ${P}_RETENTION_BATCH_SIZE=100 ${P}_RETENTION_SCAN_DELAY=2s)
  if [ "${R%% *}" != STARTED ]; then echo "MAX_AGE=$V -> $R: $(grep -o -E '(Caused by: )?[a-zA-Z.]+Exception: [^\r]{0,140}' $L | tail -1)"; continue; fi
  for k in $(seq 1 60); do [ "$(grep -c 'runtime_retention bindings_scanned' $L)" -ge 2 ] && break; sleep 2; done
  left=$($S/rig/seed.sh $DB $DBN rows m- 2>/dev/null | grep -E "^row m-[a-z0-9]+-$i " | awk '{print $2}' | sed "s/-$i\$//" | tr '\n' ' ')
  printf "MAX_AGE=%-6s still present after 2 ticks (of m-40d m-13h m-5min): [ %s]\n" "$V" "$left"
  stop $T-$i
done
echo "## [$T] done"
