#!/bin/bash
# Cost of permanently pinned families: ticks until a newly eligible family is removed.
# usage: probe7s.sh <mysql|maria> <dbname> <tag> <jar> <n> <pub|ctl>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; DBN=$2; T=$3; JAR=$4; N=$5; KIND=$6; P=QWEN_MANAGED_AGENT_RUNTIME
export SERVER_PORT=18692 BROKER_PORT=18693
if [ "$DB" = mysql ]; then PORT=33642; else PORT=43642; fi
q() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N $DBN -e "$1" 2>/dev/null; }
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
ticks() { grep -c 'runtime_retention bindings_scanned' $L; }
echo "## [$T] jar=$(basename $JAR) n=$N kind=$KIND (max-age 30d, batch 100, delay 2s)"
$S/rig/boot.sh $JAR $DB $DBN $T-migrate ${P}_BROKER_ENABLED=true > /dev/null; stop $T-migrate
t0=$(date +%s); $S/rig/seed.sh $DB $DBN pinmany $N $KIND > $S/rig/out/$T-seed.txt 2>&1
grep -q "^PINMANY $N $KIND\$" $S/rig/out/$T-seed.txt || { echo "SEED FAILED"; grep -m2 Exception $S/rig/out/$T-seed.txt; exit 1; }
echo "seeded $N families in $(( $(date +%s)-t0 ))s: bindings=$(q 'SELECT COUNT(*) FROM qwen_runtime_binding') publications=$(q 'SELECT COUNT(*) FROM qwen_tool_publication')"
L=$S/rig/logs/$T-run.log
$S/rig/boot.sh $JAR $DB $DBN $T-run ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30d ${P}_RETENTION_BATCH_SIZE=100 ${P}_RETENTION_SCAN_DELAY=2s > /dev/null
for k in $(seq 1 300); do [ "$(ticks)" -ge 40 ] && break; sleep 1; done
echo "after 40 ticks: bindings left=$(q 'SELECT COUNT(*) FROM qwen_runtime_binding') sessions=$(q 'SELECT COUNT(*) FROM qwen_runtime_session') executions=$(q 'SELECT COUNT(*) FROM qwen_tool_execution')"
echo "ticks 36-40:"; grep -o 'runtime_retention bindings_scanned.*' $L | sed -n '36,40p' | sed 's/^/  /'
for r in 1 2 3; do
  id=z-late-$T-$r; n0=$(ticks); $S/rig/seed.sh $DB $DBN late $id > /dev/null 2>&1; s0=$(date +%s)
  for k in $(seq 1 600); do [ "$(q "SELECT COUNT(*) FROM qwen_runtime_binding WHERE binding_id='$id'")" = 0 ] && break; sleep 0.5; done
  left=$(q "SELECT COUNT(*) FROM qwen_runtime_binding WHERE binding_id='$id'")
  echo "late family $r: removed=$([ "$left" = 0 ] && echo yes || echo NO) after $(( $(ticks)-n0 )) ticks / $(( $(date +%s)-s0 ))s"
  sleep 3
done
stop $T-run
echo "## [$T] done"
