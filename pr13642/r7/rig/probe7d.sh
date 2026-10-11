#!/bin/bash
# scan-delay without a unit, and enabled spellings, on the real jar. 20 s per case on a DB holding 500 pinned families.
# usage: probe7d.sh <mysql|maria> <dbname> <tag> <jar> "<ENV=VAL ...>"...
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; DBN=$2; T=$3; JAR=$4; shift 4; P=QWEN_MANAGED_AGENT_RUNTIME
export SERVER_PORT=18702 BROKER_PORT=18703
if [ "$DB" = mysql ]; then PORT=33642; else PORT=43642; fi
qs() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N -e "SHOW GLOBAL STATUS LIKE 'Questions'" 2>/dev/null | awk '{print $2}'; }
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
echo "## [$T] jar=$(basename $JAR) db=$DBN (500 pinned families), 20 s window per case"
i=0
for CASE in "$@"; do
  i=$((i+1)); L=$S/rig/logs/$T-$i.log
  R=$($S/rig/boot.sh $JAR $DB $DBN $T-$i ${P}_BROKER_ENABLED=true ${P}_RETENTION_MAX_AGE=30d ${P}_RETENTION_BATCH_SIZE=100 $CASE)
  if [ "${R%% *}" != STARTED ]; then echo "[$CASE] -> $R: $(grep -o -E '(Caused by: )?[a-zA-Z.]+Exception: [^\r]{0,160}' $L | tail -1)"; continue; fi
  n0=$(grep -c 'runtime_retention bindings_scanned' $L); q0=$(qs); sleep 20; n1=$(grep -c 'runtime_retention bindings_scanned' $L); q1=$(qs)
  printf "[%-62s] ticks in 20 s=%-4s server Questions delta=%s\n" "$CASE" "$((n1-n0))" "$((q1-q0))"
  stop $T-$i
done
echo "## [$T] done"
