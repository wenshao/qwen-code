#!/bin/bash
# Review R5-1: do publication / CSI-ACK references pin a ten-year-old family at every max-age?
# usage: probe7r.sh <mysql|maria> <dbname> <tag> <jar> <max-age>...
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; DBN=$2; T=$3; JAR=$4; shift 4; P=QWEN_MANAGED_AGENT_RUNTIME
export SERVER_PORT=18682 BROKER_PORT=18683
if [ "$DB" = mysql ]; then PORT=33642; else PORT=43642; fi
q() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N $DBN -e "$1" 2>/dev/null; }
q2() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N -e "$1" 2>/dev/null; }
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
echo "## [$T] jar=$(basename $JAR) sha=$(shasum -a 256 $JAR | cut -c1-12) engine=$(q2 'SELECT VERSION()')"
$S/rig/boot.sh $JAR $DB $DBN $T-migrate ${P}_BROKER_ENABLED=true > /dev/null
grep -o 'Successfully applied [0-9]* migrations.*now at version v[0-9]*' $S/rig/logs/$T-migrate.log; stop $T-migrate
i=0
for V in "$@"; do
  i=$((i+1)); L=$S/rig/logs/$T-$i.log
  $S/rig/seed.sh $DB $DBN pinned $i > $S/rig/out/$T-seed-$i.txt 2>&1
  grep -q "^PINNED $i\$" $S/rig/out/$T-seed-$i.txt || { echo "SEED FAILED for $i:"; grep -m2 Exception $S/rig/out/$T-seed-$i.txt; exit 1; }
  echo "-- seeded r-{ctl,pub,ack}-$i: binding+session+2 executions each, last_active/settled 3650 days ago"
  R=$($S/rig/boot.sh $JAR $DB $DBN $T-$i ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true "${P}_RETENTION_MAX_AGE=$V" ${P}_RETENTION_BATCH_SIZE=100 ${P}_RETENTION_SCAN_DELAY=2s)
  if [ "${R%% *}" != STARTED ]; then echo "MAX_AGE=$V -> $R"; continue; fi
  for k in $(seq 1 60); do [ "$(grep -c 'runtime_retention bindings_scanned' $L)" -ge 3 ] && break; sleep 2; done
  echo "MAX_AGE=$V  first ticks: $(grep -o 'runtime_retention bindings_scanned.*' $L | head -2 | tr '\n' '|')"
  for kind in ctl pub ack; do
    id=r-$kind-$i
    printf "  %-9s binding=%s session=%s executions=[%s] publication=%s csi_ack=%s\n" $id \
      "$(q "SELECT COUNT(*) FROM qwen_runtime_binding WHERE binding_id='$id'")" \
      "$(q "SELECT COUNT(*) FROM qwen_runtime_session WHERE runtime_session_id='$id-s'")" \
      "$(q "SELECT GROUP_CONCAT(execution_call_id ORDER BY execution_call_id) FROM qwen_tool_execution WHERE binding_id='$id'")" \
      "$(q "SELECT IFNULL(MAX(retention_state),'-') FROM qwen_tool_publication WHERE publication_id='publication-$id'")" \
      "$(q "SELECT COUNT(*) FROM managed_workspace_csi_worker_ack WHERE execution_call_id='$id-x1'")"
  done
  stop $T-$i
done
echo "## [$T] done"
