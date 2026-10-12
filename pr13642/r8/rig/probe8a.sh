#!/bin/bash
# Round 8: max-age bounds on the real jar. usage: probe8a.sh <mysql|maria>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; P=QWEN_MANAGED_AGENT_RUNTIME
export SERVER_PORT=18712 BROKER_PORT=18713 CPDIR=cp-r8 SEEDOUT=out-r8
NEW=$S/jars/merge-r8-8b72c287.jar; OLD=$S/jars/merge2-fixed-r7.jar
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid 2>/dev/null; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
why() { grep -o -E '(Caused by: )?[a-zA-Z.]+(Exception|Error): [^\r]{0,170}' $S/rig/logs/$1.log | tail -1; }
rows() { $S/rig/seed.sh $DB $1 rows m- 2>/dev/null | awk '/^row /{printf "%s ", $2} /^rows /{print "| count=" $NF}' | sed -E 's/-p8[a-z0-9_]*//g'; }
ticks() { grep -E 'runtime_retention bindings_scanned' $S/rig/logs/$1.log | sed -E 's/.*runtime_retention //;s/ duration_ms=[0-9]+//' | sort | uniq -c | sed -E 's/^ +//' | head -3 | tr '\n' ';'; }
schema() { local r; r=$($S/rig/boot.sh $NEW $DB $1 $2-schema ${P}_BROKER_ENABLED=true); [ "${r%% *}" = STARTED ] || { echo "schema boot failed: $r"; exit 1; }; stop $2-schema; }
echo "## A. startup matrix, $(basename $NEW) (retention + Broker enabled unless stated)"
i=0
for CASE in "${P}_RETENTION_MAX_AGE=1ns" "${P}_RETENTION_MAX_AGE=999999ns" "${P}_RETENTION_MAX_AGE=999us" "${P}_RETENTION_MAX_AGE=PT0.0009S" \
            "${P}_RETENTION_MAX_AGE=1000us" "${P}_RETENTION_MAX_AGE=1ms" "${P}_RETENTION_MAX_AGE=PT0.001S" \
            "${P}_RETENTION_MAX_AGE=1ns ${P}_RETENTION_ENABLED=false" "${P}_RETENTION_MAX_AGE=1ns ${P}_RETENTION_ENABLED=false ${P}_BROKER_ENABLED=false"; do
  i=$((i+1)); T=p8a-$DB-A$i
  R=$($S/rig/boot.sh $NEW $DB p8a_boot_$DB $T ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_SCAN_DELAY=1h $CASE)
  printf "[%-75s] %s %s\n" "${CASE//${P}_/}" "${R%% *}" "$( [ "${R%% *}" = STARTED ] || why $T)"
  [ "${R%% *}" = STARTED ] && stop $T
done
echo "## B. what the floor changes: fresh DB per case, rows m-40d / m-13h / m-5min RELEASED (no children), 15 s with scan-delay 2s"
j=0
for CASE in "OLD 1ns" "NEW 1ns" "NEW 1ms" "NEW 12h"; do
  j=$((j+1)); set -- $CASE; JAR=$NEW; [ $1 = OLD ] && JAR=$OLD; N=p8a_b${j}_$DB; T=p8a-$DB-B$j
  schema $N $T; $S/rig/seed.sh $DB $N mini p8$j >/dev/null 2>&1
  before=$(rows $N)
  R=$($S/rig/boot.sh $JAR $DB $N $T ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_SCAN_DELAY=2s ${P}_RETENTION_MAX_AGE=$2)
  if [ "${R%% *}" = STARTED ]; then sleep 15; stop $T; fi
  printf "[%s jar, max-age=%-4s] %-8s before: %s\n%38s after: %s\n%38s ticks: %s\n" "$1" "$2" "${R%% *}" "$before" "" "$(rows $N)" "" "$( [ "${R%% *}" = STARTED ] && ticks $T || why $T)"
done
echo "## C. no upper bound: one DB, same three rows, 15 s per value"
N=p8a_up_$DB; schema $N p8a-$DB-Cs; $S/rig/seed.sh $DB $N mini p8u >/dev/null 2>&1; echo "before: $(rows $N)"
k=0
for V in 36500 1480000 400000000000 200000000000000; do
  k=$((k+1)); T=p8a-$DB-C$k
  R=$($S/rig/boot.sh $NEW $DB $N $T ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_SCAN_DELAY=2s ${P}_RETENTION_MAX_AGE=$V)
  if [ "${R%% *}" = STARTED ]; then sleep 15; stop $T; fi
  printf "[max-age=%-16s] %-8s ticks: %s\n%28s failed ticks: %s %s\n%28s after: %s\n" "$V" "${R%% *}" "$(ticks $T)" "" "$(grep -c 'Runtime retention failed' $S/rig/logs/$T.log)" "$(why $T)" "" "$(rows $N)"
done
echo "## done"
